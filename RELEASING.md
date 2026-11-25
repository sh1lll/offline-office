# Posting a release

Everything below runs from this folder.

1. Check that everything still works:

   ```sh
   node --test
   node build.mjs
   ```

   All tests should pass. The converter tests need Google Chrome installed.

2. Commit and push:

   ```sh
   git add .
   git commit -m "what changed"
   git push
   ```

   GitHub Pages picks up the push on its own, at https://sh1lll.github.io/offline-office/.

3. Make a release with the next version number, and attach the single file. `dist/` isn't in git, so
   the release is how people get it:

   ```sh
   gh release create v1.1.0 dist/offline-office.html --title "Offline Office 1.1" --notes "what changed"
   ```

4. Open the Pages link and the downloaded file once each, and drop a PDF in to check it works.
