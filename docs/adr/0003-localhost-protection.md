# Three layers of localhost protection

The server can act as the user on GitHub and Jira, and any web page the user visits can reach localhost. So it binds 127.0.0.1 only, rejects requests whose `Host` isn't its own or whose `Origin` (when present) isn't the app's, and requires a secret cookie set once from a bootstrap URL carrying a token read from a 0600 file. Header checks alone were rejected: the cookie costs one click at install and covers whatever they miss (DNS rebinding variants, a forgotten endpoint).
