#!/usr/bin/env python3
"""Build AIRIZ-only updater metadata from actual release binaries (stdlib only)."""
from pathlib import Path
from urllib.request import Request, urlopen
from datetime import datetime, timezone
import argparse
import base64
import hashlib
import json
import os
import re

REPO = Path(__file__).resolve().parents[4]
WEB = REPO / 'apps' / 'airiz-motor' / 'web'
API = 'https://api.github.com/repos/juwpegatron/projects'
DOWNLOADS = 'https://github.com/juwpegatron/projects/releases/download/'


def version_tuple(version):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Only numeric AIRIZ desktop versions are supported.')
    return tuple(int(part) for part in version.split('.'))


def digest_stream(stream):
    sha256 = hashlib.sha256()
    sha512 = hashlib.sha512()
    size = 0
    prefix = b''
    while True:
        chunk = stream.read(1024 * 1024)
        if not chunk:
            break
        if not prefix:
            prefix = chunk[:2]
        size += len(chunk)
        sha256.update(chunk)
        sha512.update(chunk)
    if prefix != b'MZ' or size < 1_000_000:
        raise ValueError('Release asset is not a complete Windows executable.')
    return {
        'size': size, 'sha256': sha256.hexdigest(),
        'sha512': base64.b64encode(sha512.digest()).decode('ascii'),
    }


def update_catalog(version):
    path = REPO / 'scripts' / 'apps.json'
    source = path.read_text(encoding='utf-8')
    decoder = json.JSONDecoder()
    for match in re.finditer(r'(?m)^([ \t]*)\{', source):
        indent = match.group(1)
        start = match.start() + len(indent)
        entry, end = decoder.raw_decode(source, start)
        if not isinstance(entry, dict) or entry.get('id') != 'airiz-motor':
            continue
        installer = DOWNLOADS + f'airiz-desktop-v{version}/AIRIZ-Console-Setup-{version}-x64.exe'
        entry['links']['app'] = installer
        for link in entry.get('card_links', []):
            if link['label'] == 'Windows app':
                link['path'] = installer
        replacement = json.dumps(entry, indent=1, ensure_ascii=False).replace('\n', '\n' + indent)
        path.write_text(source[:start] + replacement + source[end:], encoding='utf-8')
        return
    raise ValueError('AIRIZ catalog entry could not be updated without rewriting other entries.')


def sync(tag, local_dist=None):
    if not re.fullmatch(r'airiz-desktop-v\d+\.\d+\.\d+', tag):
        raise ValueError('Not an AIRIZ desktop release tag.')
    version = tag.removeprefix('airiz-desktop-v')
    version_tuple(version)
    feed_dir = WEB / 'updates' / 'windows'
    existing_path = feed_dir / 'release.json'
    existing = json.loads(existing_path.read_text(encoding='utf-8')) if existing_path.exists() else None
    if existing and version_tuple(existing['version']) > version_tuple(version):
        print('Ignoring an older release; the update feed will not be downgraded.')
        return

    release_date = datetime.now(timezone.utc).isoformat()
    remote_assets = {}
    if local_dist is None:
        headers = {'User-Agent': 'AIRIZ-update-feed', 'Accept': 'application/vnd.github+json'}
        if os.environ.get('GITHUB_TOKEN'):
            headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
        with urlopen(Request(API + '/releases/tags/' + tag, headers=headers), timeout=60) as response:
            release = json.load(response)
        if release['draft'] or release['tag_name'] != tag:
            raise ValueError('Release is not public and correctly tagged.')
        remote_assets = {asset['name']: asset for asset in release['assets']}
        release_date = release['published_at']

    assets = {}
    for kind, filename_kind in [('installer', 'Setup'), ('portable', 'Portable')]:
        name = f'AIRIZ-Console-{filename_kind}-{version}-x64.exe'
        url = DOWNLOADS + tag + '/' + name
        if local_dist is not None:
            with (local_dist / name).open('rb') as stream:
                info = digest_stream(stream)
        else:
            remote = remote_assets[name]
            if remote['browser_download_url'] != url:
                raise ValueError('Unexpected executable URL.')
            # Public download: do not forward the repository token to asset redirects.
            with urlopen(Request(url, headers={'User-Agent': 'AIRIZ-update-feed'}), timeout=180) as stream:
                info = digest_stream(stream)
            if remote['size'] != info['size'] or (remote.get('digest') and remote['digest'] != 'sha256:' + info['sha256']):
                raise ValueError('GitHub asset digest/size mismatch.')
        assets[kind] = {'url': url, **info}

    if existing and existing['version'] == version:
        for kind in assets:
            if existing[kind]['sha256'] != assets[kind]['sha256']:
                raise ValueError('Refusing to replace a published version with different binaries.')
        release_date = existing['releaseDate']

    manifest = {
        'version': version,
        'files': [{key: assets['installer'][key] for key in ['url', 'sha512', 'size']}],
        'path': assets['installer']['url'], 'sha512': assets['installer']['sha512'],
        'releaseDate': release_date,
        'releaseName': 'AIRIZ Console ' + version,
    }
    catalog = {
        'version': version, 'releaseDate': release_date,
        'releasePage': 'https://github.com/juwpegatron/projects/releases/tag/' + tag,
        **assets,
    }
    feed_dir.mkdir(parents=True, exist_ok=True)
    # JSON is valid YAML and is parsed by electron-updater's YAML parser.
    (feed_dir / 'latest.yml').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    existing_path.write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8')
    update_catalog(version)
    print(json.dumps({'version': version, 'installer_bytes': assets['installer']['size'], 'feed_updated': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag', required=True)
    parser.add_argument('--local-dist', type=Path)
    arguments = parser.parse_args()
    sync(arguments.tag, arguments.local_dist)
