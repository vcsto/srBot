---
name: srbot-setup
description: Set up srBot (NVDA screen reader testing) on this computer and check that it is ready. Use right after cloning the repository, or when a test will not start.
---

# Set up the kit

The tester may not be technical. Do each step for them and report the result in plain words.

1. Check that this is Windows. The kit drives NVDA, which only runs on Windows. If it is not Windows, say so and stop.
2. Run `node --version`. If Node.js is missing or older than version 18, ask the tester to install the LTS version from https://nodejs.org, reopen Claude Code, and run this again.
3. Run `npm install` in the repository root.
4. Run `node scripts/kit.js doctor` and read every line.
   - **NVDA installed**: if missing, ask the tester to install it from https://www.nvaccess.org/download/. It is free.
   - **NVDA is not already running**: if it is, ask the tester to quit it with NVDA+Q. Explain that the kit starts its own NVDA session so their settings and add-ons are left alone. Do not close it yourself.
   - **Browser found**: Google Chrome is preferred; Microsoft Edge also works.
   - **Keyboard helper can start**: if this fails, PowerShell scripts are probably blocked by the organisation. The tester will need to ask their IT team; the kit cannot work around that.
5. When doctor says "Ready to test", tell the tester they can start with `/srbot` followed by a web address, or by simply asking you to test a site.

Mention once, briefly: during a test the kit uses the keyboard and mouse, NVDA runs silently unless they ask to hear it, and results are saved in the `runs` folder on this computer and nowhere else.
