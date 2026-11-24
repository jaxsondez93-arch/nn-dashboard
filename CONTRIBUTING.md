# Contributing

Small, friendly project. Ideas and fixes are welcome.

- Keep it dependency-free: the server uses only the Python standard library.
- Run the tests before sending anything: `python3 -B -m unittest discover -s tests`. They use synthetic data (`demo/make_demo_data.py`), never real logs.
- Never commit personal data: usernames, hostnames, home paths, network addresses, tokens, keys, or real screenshots that show them. `.gitignore` already excludes secrets and data files.
- Explanations aimed at non-experts are as welcome as code: see [docs/PLAIN_ENGLISH.md](docs/PLAIN_ENGLISH.md).
