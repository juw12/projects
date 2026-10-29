'use strict';

// 1.10.0: talk to the AIRIZ speaker and listen to its microphone over the USB console.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const audio = require('../../web/audio-link.js');

function tone(seconds, rate, frequency, amplitude) {
  const samples = new Int16Array(Math.round(seconds * rate));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin(2 * Math.PI * frequency * i / rate) * amplitude);
  }
  return samples;
}

function snrDb(reference, test) {
  let signal = 0;
  let noise = 0;
  for (let i = 0; i < reference.length; i++) {
    signal += reference[i] * reference[i];
    noise += (reference[i] - test[i]) * (reference[i] - test[i]);
  }
  return 10 * Math.log10(signal / Math.max(noise, 1e-9));
}

test('IMA ADPCM: the decoder follows the encoder exactly and speech-like sound stays clear', () => {
  const input = new Int16Array(8000);
  for (let i = 0; i < input.length; i++) {
    input[i] = Math.round(9000 * Math.sin(i * 0.07) + 4000 * Math.sin(i * 0.31) + (i % 7) * 50);
  }
  const bytes = audio.encodeAdpcm(input);
  assert.equal(bytes.length, 4000, 'two samples per byte');
  const output = audio.decodeAdpcm(bytes, input.length);
  assert.equal(output.length, input.length);
  assert.ok(snrDb(input, output) > 18, 'ADPCM keeps the sound recognisable');
  const odd = audio.encodeAdpcm(input.subarray(0, 5));
  assert.equal(odd.length, 3);
  assert.equal(audio.decodeAdpcm(odd, 5).length, 5, 'the padding nibble is ignored');
});

test('base64 and MD5 match Node', () => {
  for (const size of [0, 1, 2, 3, 4, 5, 255, 1000, 65537]) {
    const bytes = crypto.randomBytes(size);
    const text = audio.bytesToBase64(bytes);
    assert.equal(text, bytes.toString('base64'), 'base64 of ' + size + ' bytes');
    assert.deepEqual(Buffer.from(audio.base64ToBytes(text)), bytes);
    assert.equal(audio.md5Hex(bytes), crypto.createHash('md5').update(bytes).digest('hex'), 'md5 of ' + size + ' bytes');
  }
  assert.equal(audio.md5Hex('AIRIZ'), crypto.createHash('md5').update('AIRIZ').digest('hex'));
  assert.equal(audio.base64ToBytes('ab$d'), null, 'damaged base64 is refused');
  assert.equal(audio.base64ToBytes('abc'), null);
});

test('resampling keeps speech frequencies and removes what 8 kHz cannot carry', () => {
  const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  const make = (frequency, rate) => Float32Array.from(tone(1, rate, frequency, 16000), value => value / 32768);
  const speech = audio.resample(make(1000, 48000), 48000, 8000);
  assert.equal(speech.length, 8000);
  assert.ok(Math.abs(rms(speech.subarray(200, 7800)) - rms(make(1000, 48000))) < 0.02, '1 kHz passes');
  const tooHigh = audio.resample(make(6000, 48000), 48000, 8000);
  assert.ok(rms(tooHigh.subarray(200, 7800)) < 0.01, '6 kHz is removed instead of folding back');
  const cd = audio.resample(make(440, 44100), 44100, 8000);
  assert.equal(cd.length, 8000);
  // streaming playback resampler: same result in pieces
  const source = make(700, 8000);
  const whole = audio.resample(source, 8000, 48000);
  const stream = audio.createStreamResampler(8000, 48000);
  const pieces = [];
  for (let i = 0; i < source.length; i += 504) pieces.push(stream.process(source.subarray(i, i + 504)));
  pieces.push(stream.flush());
  const joined = Float32Array.from(pieces.flatMap(piece => Array.from(piece)));
  assert.ok(Math.abs(joined.length - whole.length) <= 2, 'stream gives the same length');
  let maxDiff = 0;
  for (let i = 100; i < whole.length - 100; i++) maxDiff = Math.max(maxDiff, Math.abs(joined[i] - whole[i]));
  assert.ok(maxDiff < 1e-4, 'stream matches the one-shot resampler');
});

test('voice preparation trims silence, evens out the level and never clips', () => {
  const rate = 8000;
  const quiet = new Float32Array(rate * 3);
  for (let i = rate; i < rate * 2; i++) quiet[i] = 0.02 * Math.sin(2 * Math.PI * 300 * i / rate);
  const prepared = audio.prepareVoice(quiet);
  assert.ok(prepared.seconds > 0.9 && prepared.seconds < 1.4, 'about 1 s of speech plus margins: ' + prepared.seconds);
  assert.ok(prepared.gainDb > 10, 'a quiet voice is made louder');
  const peak = prepared.samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  assert.ok(peak > 8000 && peak < 32767, 'loud enough, not clipped: ' + peak);
  const loud = Float32Array.from(quiet, value => value * 45);
  const limited = audio.prepareVoice(loud);
  assert.ok(limited.samples.every(value => Math.abs(value) < 32767));
  assert.ok(audio.prepareVoice(new Float32Array(rate)).silent, 'silence is reported');
  const hum = Float32Array.from({ length: rate }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 50 * i / rate) + 0.1 * Math.sin(2 * Math.PI * 800 * i / rate));
  const cleaned = audio.prepareVoice(hum, { maxGain: 1 });
  const out = audio.toFloat(cleaned.samples);
  const corr = f => {
    let s = 0;
    let c = 0;
    for (let i = 0; i < out.length; i++) {
      s += out[i] * Math.sin(2 * Math.PI * f * i / rate);
      c += out[i] * Math.cos(2 * Math.PI * f * i / rate);
    }
    return Math.hypot(s, c) / out.length;
  };
  assert.ok(corr(50) < corr(800) * 0.2, '50 Hz hum is removed by the high-pass');
});

test('listen frames: encode, check, decode; damaged lines are refused', () => {
  const samples = tone(0.2, 8000, 440, 8000);
  const lines = audio.encodeListenMono(samples, 7);
  assert.equal(lines[lines.length - 1], '@AS1,7,end,4');
  const frames = lines.slice(0, -1).map(audio.parseFrameLine);
  assert.ok(frames.every(Boolean));
  assert.deepEqual(frames.map(frame => frame.blk), [0, 1, 2, 3]);
  assert.deepEqual(frames.map(frame => frame.count), [504, 504, 504, 88]);
  const decoded = frames.flatMap(frame => Array.from(audio.decodeFrame(frame)));
  assert.equal(decoded.length, samples.length);
  assert.ok(snrDb(samples, decoded) > 18);
  const broken = lines[1].replace(/,([A-Za-z])/, (match, letter) => ',' + (letter === 'A' ? 'B' : 'A'));
  assert.equal(audio.parseFrameLine(broken), null, 'a changed character fails the checksum');
  assert.equal(audio.parseFrameLine(lines[1].slice(0, -3)), null);
  assert.equal(audio.parseFrameLine('@AU1,1,2,3'), null);
  assert.deepEqual(audio.parseStatusLine('@AS1,3,norec,device busy'), { seg: 3, event: 'norec', args: ['device busy'] });
});

test('the console filter takes voice lines out of the console stream, also split and mixed', () => {
  const lines = audio.encodeListenMono(tone(0.1, 8000, 500, 6000), 2);
  const frames = [];
  const statuses = [];
  const markers = [];
  const filter = audio.createStreamFilter({
    frame: frame => frames.push(frame),
    status: status => statuses.push(status),
    marker: name => markers.push(name),
  });
  // a typed command echo interrupted by a frame line, CRLF line ends, random chunk splits
  const stream = '~ # diag mo' + lines[0] + '\r\ntor pan forward 2 10\r\nDone\r\n' + lines[1] + '\r\n'
    + lines[2] + '\r\n__AZPLAYED__\r\n~ # ';
  let shown = '';
  for (let i = 0; i < stream.length;) {
    const size = 1 + ((i * 7919) % 97);
    shown += filter.feed(stream.slice(i, i + size));
    i += size;
  }
  assert.equal(shown, '~ # diag motor pan forward 2 10\r\nDone\r\n~ # ');
  assert.equal(frames.length, 2);
  assert.deepEqual(statuses.map(status => status.event), ['end']);
  assert.deepEqual(markers, ['PLAYED']);
  // text that only looks like the start of a marker is not swallowed for long
  const plain = audio.createStreamFilter({});
  assert.equal(plain.feed('price @ 5'), 'price @ 5');
  assert.equal(plain.feed('mail me@'), 'mail me');
  assert.equal(plain.feed('host.com\n'), '@host.com\n');
  const runaway = audio.createStreamFilter({});
  assert.equal(runaway.feed('@AU1,' + 'x'.repeat(5000)).length, 5005, 'an endless fake line is shown again');
});

test('device scripts, upload plan and commands are self-consistent', () => {
  const scripts = audio.deviceScripts();
  assert.deepEqual(scripts.map(script => script.name), ['enc.awk', 'talk.awk', 'listen.sh']);
  for (const script of scripts) {
    assert.equal(script.md5, crypto.createHash('md5').update(script.text).digest('hex'));
    assert.equal(Buffer.from(script.base64, 'base64').toString('utf8'), script.text);
    assert.doesNotMatch(script.text, /\r/, 'device scripts use LF only');
    assert.match(script.text, /1\.10\.0/, 'scripts carry the version (new md5 when they change)');
  }
  const text = 'A'.repeat(2500);
  const plan = audio.uploadPlan(text, 1000);
  assert.deepEqual(plan.lines.map(line => line.length), [1001, 1001, 501]);
  assert.equal(plan.byteCount, 2503, 'head -c gets exactly the bytes that are sent');
  assert.equal(audio.talkWavSize(8000, 'stereo16'), 44 + 64000);
  assert.equal(audio.talkWavSize(8000, 'mono8'), 44 + 16000);
  assert.match(audio.commands.receive('/tmp/airiz/talk.adp', 2503), /head -c 2503 > \/tmp\/airiz\/talk\.adp\.b64/);
  assert.match(audio.commands.receive('/x', 1), /__AZ""RDY__.*__AZ""HD_\$\?__/, 'markers are split so the echo never matches');
  const start = audio.commands.listenStart(80, 2, 'diag audio record -p -t {s} -v {gain}');
  assert.match(start, /listen\.sh 80 2 "diag audio record -p -t %T -v %G" \/tmp\/dmic_record_output\.wav/);
  assert.match(audio.commands.listenStart(80, 2, 'rm -rf /; reboot'), /"diag audio record -p -t %T -v %G"/, 'unsafe templates fall back');
  assert.match(audio.commands.play(150), /diag audio volume 100 /, 'volume is clamped');
  assert.match(audio.commands.play(60, 'diag audio play {file}'), /diag audio play \/tmp\/airiz\/talk\.wav/);
  assert.match(audio.commands.buildWav(24000, 'mono16'), /awk -v n=24000 -v rate=16000 -v ch=1 -f \/tmp\/airiz\/talk\.awk/);
  const estimate = audio.estimateTalk(5, 'stereo16');
  assert.ok(estimate.upload > 2 && estimate.upload < 4, 'about 2-3 s to send 5 s of voice: ' + estimate.upload);
  assert.deepEqual(audio.chunkText('abcdefg', 3), ['abc', 'def', 'g']);
});

// Runs the device scripts with a real BusyBox (busybox-w32 on Windows, busybox on Linux) when
// one is available: set AIRIZ_BUSYBOX to its path. Otherwise the test is skipped.
function findBusybox() {
  const candidates = [process.env.AIRIZ_BUSYBOX, 'busybox'].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['awk', 'BEGIN { print 1 }'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() === '1') return candidate;
  }
  return null;
}

const busybox = findBusybox();

test('BusyBox runs enc.awk and talk.awk bit-exactly like the JavaScript', { skip: !busybox && 'no busybox (set AIRIZ_BUSYBOX)' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airiz-audio-'));
  try {
    for (const script of audio.deviceScripts()) fs.writeFileSync(path.join(dir, script.name), script.text);
    // listen: 16 kHz stereo PCM -> frames
    const frames = 16000 * 1.3;
    const pcm = new Int16Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      pcm[2 * i] = Math.round(12000 * Math.sin(i * 0.05) + 3000 * Math.sin(i * 0.9));
      pcm[2 * i + 1] = Math.round(9000 * Math.sin(i * 0.051 + 0.3));
    }
    const header = Buffer.alloc(44);
    fs.writeFileSync(path.join(dir, 'seg.wav'), Buffer.concat([header, Buffer.from(pcm.buffer)]));
    const listen = execFileSync(busybox, ['sh', '-c', 'tail -c +45 seg.wav | od -An -v -td2 | awk -v seg=5 -f enc.awk'], { cwd: dir, encoding: 'utf8' });
    assert.deepEqual(listen.replace(/\r/g, '').trim().split('\n'), audio.encodeListenStereo(pcm, 5));
    // talk: ADPCM -> WAV in every output format
    const voice = tone(0.9, 8000, 330, 9000);
    for (let i = 0; i < voice.length; i++) voice[i] += Math.round(2000 * Math.sin(i * 1.3));
    const adpcm = audio.encodeAdpcm(voice);
    fs.writeFileSync(path.join(dir, 'talk.adp'), adpcm);
    const decoded = audio.decodeAdpcm(adpcm, voice.length);
    for (const [name, format] of Object.entries(audio.FORMATS)) {
      execFileSync(busybox, ['sh', '-c', 'od -An -v -tu1 talk.adp | awk -v n=' + voice.length + ' -v rate=' + format.rate
        + ' -v ch=' + format.channels + ' -f talk.awk | base64 -d > talk.wav'], { cwd: dir });
      const wav = fs.readFileSync(path.join(dir, 'talk.wav'));
      assert.equal(wav.length, audio.talkWavSize(voice.length, name), name + ' size');
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.readUInt16LE(22), format.channels);
      assert.equal(wav.readUInt32LE(24), format.rate);
      const body = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length));
      const step = format.rate / 8000;
      let previous = 0;
      for (let i = 0; i < decoded.length; i++) {
        const outIndex = (i * step + step - 1) * format.channels;
        assert.equal(body[outIndex], decoded[i], name + ' sample ' + i);
        if (step === 2) assert.equal(body[(i * 2) * format.channels], Math.trunc((previous + decoded[i]) / 2));
        if (format.channels === 2) assert.equal(body[outIndex + 1], decoded[i]);
        previous = decoded[i];
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
