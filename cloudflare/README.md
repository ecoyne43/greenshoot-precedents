# Precedents images at Cloudflare

Why: images stored in an R2 bucket and served by a small Cloudflare Worker go straight from Cloudflare to whoever is
looking at or downloading them. Cloudflare doesn't charge for R2 downloads, and none of that traffic touches Netlify
(so no Netlify credits). R2 storage: first 10 GB a month free, then US$0.015 per GB (Nov 2026). The library at about
1,000 precedents with up to 10 images each is roughly 2.5 to 5 GB. Workers free plan: 100,000 requests a day.

Until this is set up, the site keeps images in Netlify Blobs exactly as before.

## Set up (about 20 minutes, once)
1. **Cloudflare account**: sign up at dash.cloudflare.com (free).
2. **Bucket**: R2 Object Storage > enable R2 (Cloudflare may ask for a card even for the free allowance) > Create
   bucket, name `greenshoot-precedents-images`. Leave public access off.
3. **Worker**: Workers & Pages > Create > Worker (Hello World) > name `precedents-images` > Deploy. Then Edit code,
   replace everything with the contents of `images-worker.js`, and Deploy.
4. **Connect the bucket**: in the Worker, Settings > Bindings > Add > R2 bucket. Variable name `IMAGES`, bucket
   `greenshoot-precedents-images`.
5. **Two secrets**: Settings > Variables and Secrets > Add, type Secret:
   - `IMAGE_TOKEN`: copy it from the Precedents site's admin page (`/#/admin`, "Key for the Cloudflare Worker").
   - `UPLOAD_SECRET`: a long random string you make up (a password manager can generate one).
   Deploy again if asked.
6. **Worker address**: copy it from the Worker's overview, like `https://precedents-images.<you>.workers.dev`.
7. **Netlify**: Project configuration > Environment variables, add `IMAGES_URL` (the Worker address) and
   `IMAGES_UPLOAD_SECRET` (the same string as `UPLOAD_SECRET`, marked secret). Then Deploys > Trigger deploy.
8. **Copy the existing images**: open `/#/admin` on the site, click "Copy images to Cloudflare" and wait for "Done".
9. **Check**: open the library; right-click an image > Open image in new tab: the address starts with your
   `workers.dev` address.

## Good to know
- **Changing the team password** changes the image key. Update `IMAGE_TOKEN` in the Worker from `/#/admin` straight
  after, or images won't show.
- Copying deletes nothing from Netlify; older copies of the extension or Mac panel are redirected to Cloudflare.
- Image addresses carry the key, so anyone given an image address can open that image (as before). They can't list
  or find other images.
- Inbox uploads (before approval) still go through Netlify; they're few and temporary.
