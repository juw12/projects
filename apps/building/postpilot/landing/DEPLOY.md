# Deploying PostPilot in 60 seconds

Your landing page is a single HTML file at `index.html`. You can host it free in two ways.

## Option A: Netlify Drop (recommended, 60 seconds)

1. Open https://app.netlify.com/drop in your browser
2. Drag the entire `landing` folder onto the page (or just the `index.html` file)
3. Wait ~10 seconds
4. Netlify gives you a public URL like `https://random-name-123.netlify.app`
5. Done. Your site is live. No account needed for the free tier.

To use a custom domain (later): create a free Netlify account, claim the site, point your domain's DNS to Netlify.

## Option B: GitHub Pages (free forever, custom domain friendly)

1. Create a free GitHub account at github.com
2. Create a new repository called `postpilot` (public, no README)
3. Upload `index.html` to the root of that repo
4. Go to Settings → Pages
5. Under "Source", pick "Deploy from a branch" → `main` → `/ (root)`
6. Save. After ~60 seconds, your site is live at `https://YOUR-USERNAME.github.io/postpilot`

To use a custom domain: Settings → Pages → Custom domain → enter your domain → update DNS at your registrar.

## Replacing the CTA links with your real payment URL

Search the file for `href="#start"`. Replace each instance with your real checkout link:

- **Stripe Payment Link** (recommended): Stripe Dashboard → Payment Links → New → set price → copy link
- **Gumroad**: Gumroad Dashboard → New Product → set price → copy checkout link
- **Lemon Squeezy**: same idea

Replace all four occurrences:
1. The nav "Start free" button
2. The hero CTA
3. The three pricing tier buttons
4. The final CTA section

After saving, re-upload the file to Netlify/GitHub. Changes go live in ~30 seconds.

## Things to update before going live

1. **Contact email** in the footer: change `hello@postpilot.example` to a real address
2. **Pricing**: confirm $99 / $199 / $399 match your actual Stripe/Gumroad products
3. **Refund language** in FAQ: confirm it matches your actual policy
4. **Sample posts**: keep the "Sample — for [niche]" tag visible so prospects don't think they're reading real client work
5. **Open Graph image**: for now there's no `og:image` — add a 1200x630 image when you have one

## Customizing the look

Open `index.html` in any text editor. At the top, inside the `<style>` block, find:

```css
:root{
  --accent:#F97316;   /* change this to your brand color */
  --ink:#0F172A;      /* change this for darker/lighter text */
  --paper:#FFFFFF;    /* background color */
}
```

Save and re-upload. The whole page re-skins from those 3 lines.
