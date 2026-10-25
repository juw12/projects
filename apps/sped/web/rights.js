/* User-declared publishing notes, not a license verifier or legal clearance.
 * This module makes no network calls, downloads no catalog music and never
 * blocks local audio editing based on song titles or unverified declarations. */
(function (root) {
  'use strict';
  const H = root.Sped;
  const bases = {
    unknown: 'Not documented',
    owned: 'I control the recording and composition',
    permission: 'Permission / negotiated license',
    'remix-license': 'License expressly permits my remix and use',
    'platform-only': 'Platform-library use only',
  };
  const platforms = {
    tiktok: 'TikTok',
    youtube: 'YouTube / Shorts',
    instagram: 'Instagram / Reels',
    other: 'Other / multiple platforms',
  };
  const links = [
    { label: 'CapCut material and music license', url: 'https://www.capcut.com/clause/material-license-agreement' },
    { label: 'TikTok commercial music terms', url: 'https://www.tiktok.com/legal/page/global/commercial-music-library-user-terms/en' },
    { label: 'YouTube: externally added music in Shorts', url: 'https://support.google.com/youtube/answer/16215842' },
    { label: 'YouTube Shorts music eligibility', url: 'https://support.google.com/youtube/answer/13486873' },
    { label: 'YouTube Audio Library terms/help', url: 'https://support.google.com/youtube/answer/3376882' },
  ];

  function boundedText(value, max, name) {
    if (value === undefined) {
      return '';
    }
    if (typeof value !== 'string' || value.length > max) {
      throw new Error(name + ' must be text of at most ' + max + ' characters.');
    }
    return value.trim();
  }

  function declaration(input) {
    const d = input === undefined ? {} : input;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      throw new Error('Source permission notes must be an object.');
    }
    const basis = d.basis === undefined ? 'unknown' : d.basis;
    if (!Object.prototype.hasOwnProperty.call(bases, basis)) {
      throw new Error('Unknown permission declaration.');
    }
    return {
      basis: basis,
      reference: boundedText(d.reference, 500, 'License link/reference'),
      credit: boundedText(d.credit, 500, 'Credit'),
      restrictions: boundedText(d.restrictions, 1000, 'License restrictions'),
    };
  }

  function publication(input) {
    const p = input === undefined ? {} : input;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      throw new Error('Publishing preferences must be an object.');
    }
    const platform = p.platform === undefined ? 'tiktok' : p.platform;
    const commercial = p.commercial === undefined ? false : p.commercial;
    if (!Object.prototype.hasOwnProperty.call(platforms, platform) || typeof commercial !== 'boolean') {
      throw new Error('Invalid platform or commercial-use preference.');
    }
    return { platform: platform, commercial: commercial };
  }

  function review(tracks, preferences) {
    const p = publication(preferences);
    const warnings = [];
    const sources = tracks.filter(function (t) {
      return t.ready !== false && t.role !== 'off';
    }).map(function (t) {
      const d = declaration(t.rights);
      if (d.basis === 'unknown') {
        warnings.push(t.name + ': permissions are not documented. Uploading or buying a file does not establish remix or publication rights.');
      } else if (d.basis === 'platform-only') {
        warnings.push(t.name + ': an in-platform library license does not automatically cover exporting music into Sped, remixing it here, or redistributing the resulting sound. Use the licensed library inside its permitted workflow or obtain separate rights.');
      } else {
        warnings.push(t.name + ': ' + bases[d.basis] + ' is your declaration, not something Sped has verified. Check recording, composition, derivative-use and distribution permissions.');
      }
      return { name: t.name, declaration: d };
    });
    if (p.commercial) {
      warnings.push('Commercial/branded use: confirm advertising, monetization, territories, term and sublicensing rights for every source. A personal-use library is not sufficient by default.');
    }
    const guidance = {
      tiktok: 'For a TikTok-specific video, consider adding music through TikTok’s permitted in-app library. Business/branded uses require appropriate commercial rights; check the CML track and placement terms.',
      youtube: 'For Shorts, use the Shorts audio tools where their music terms allow, or suitable YouTube Audio Library music. Read track-specific attribution and license requirements; externally added music can receive claims.',
      instagram: 'Use music authorized for the intended Instagram account, region and use. CapCut or TikTok music permissions do not automatically transfer to Reels.',
      other: 'For cross-platform or standalone remix distribution, obtain rights that expressly cover those outputs. A platform-specific music license is not a portable blanket license.',
    }[p.platform];
    return {
      format: 'sped-publishing-notes',
      version: H.VERSION,
      scope: 'Current active session sources; not proof of clearance or a manifest of any previously rendered file.',
      verified: false,
      preferences: p,
      sources: sources,
      warnings: warnings,
      guidance: guidance,
      reminder: 'Pitch changes, short duration, attribution alone, and a local-only editor do not automatically make a use lawful. Exceptions and rights vary by jurisdiction and license. No rights are granted by this report.',
      officialReferences: links,
    };
  }

  H.rights = { bases: bases, platforms: platforms, declaration: declaration, publication: publication, review: review, links: links };
})(typeof globalThis !== 'undefined' ? globalThis : this);
