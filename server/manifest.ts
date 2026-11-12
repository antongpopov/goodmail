/**
 * The web app manifest, so that "Add to Home Screen" gives a proper app: its own window (no browser bars), the right name and an icon.
 * The name comes from the config's `title=`, which is why this is served by the server instead of being a static file; and because the
 * page title carries the unread count ("(3) My mailoffice"), a manifest is also what keeps that count out of the shortcut's name.
 */
/** Up to 16 characters, cut at a word boundary (home screens show about that much under the icon). */
function shortName(name: string) {
  if (name.length <= 16) return name;
  const words = name.split(/\s+/);
  let out = words[0].slice(0, 16);
  for (const w of words.slice(1)) {
    if ((out + ' ' + w).length > 16) break;
    out += ' ' + w;
  }
  return out;
}

export function manifestFor(title: string) {
  const name = title.trim() || 'goodmail';
  return {
    name,
    short_name: shortName(name),
    description: 'Webmail',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f6cbd',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
