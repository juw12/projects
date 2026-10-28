/* Orbis Chat client configuration.
 *
 * Leave ORBIS_CHAT_SERVER empty when the page is served by the Orbis server
 * itself (python server/server.py, Docker, Fly, Render...).
 *
 * When the front-end is hosted somewhere without the backend (for example
 * GitHub Pages), set this to the HTTPS address of your deployed Orbis server
 * so every visitor connects to it automatically, e.g.
 *   window.ORBIS_CHAT_SERVER = 'https://orbis-chat.fly.dev';
 * Users can also override it from the sign-in screen ("Server: Change").
 */
window.ORBIS_CHAT_SERVER = '';
