# GitHub Repo Description
High-performance tennis portfolio for Asuntha Fleming — SEO-ready, asset-optimized, and built for Cloudflare Pages deployment.

---

# README.md

## Asuntha Fleming — Tennis Portfolio
A refined, fast, SEO-forward tennis portfolio for Asuntha Fleming (Muscat, Oman). Built as a clean static site (HTML/CSS/JS) with structured data, sitemap support, and Cloudflare Pages–friendly headers/caching.

### Live URL
- Cloudflare Pages: https://asunthafleming.pages.dev/

---

## Features
- **Static + fast**: plain HTML/CSS/JS (no framework)
- **SEO-ready**: title/description, canonical, Open Graph, Twitter cards
- **Structured data**: Schema.org `Person` JSON-LD
- **Indexable**: robots meta set to `index, follow`
- **Sitemap + robots.txt** included
- **Security + caching** via `_headers` (Cloudflare Pages)
- **Image gallery + lightbox** (vanilla JS)
- **Responsive layout** (mobile + desktop)

---

## Project Structure


/
├─ index.html
├─ main.css
├─ main.js
├─ robots.txt
├─ sitemap.xml
├─ _headers
├─ site.webmanifest
└─ assets/
├─ images/
│  ├─ asunthafleming.jpg
│  ├─ flemingasuntha.jpg
│  ├─ af.jpg
│  ├─ action1.jpg
│  ├─ action2.jpg
│  ├─ action3.jpg
│  ├─ action4.jpg
│  └─ action5.jpg
└─ icons/
├─ favicon.ico
├─ favicon-32x32.png
├─ favicon-48x48.png
├─ favicon-64x64.png
├─ apple-touch-icon.png
├─ apple-touch-icon152x152.png
├─ apple-touch-icon120x120.png
├─ android-chrome-192x192.png
├─ android-chrome-512x512.png
├─ safari-pinned-tab.svg
└─ mstile-144x144.png

---

## Local Preview
Any static server works.

### Option A: VS Code Live Server
1. Open the folder in VS Code
2. Right click `index.html`
3. **Open with Live Server**

### Option B: Python
```bash
python3 -m http.server 8080

Open:
	•	http://localhost:8080

⸻

Deploy to Cloudflare Pages (GitHub)
	1.	Push this repo to GitHub (public or private).
	2.	In Cloudflare Dashboard:
	•	Workers & Pages → Create application → Pages → Connect to Git
	3.	Select the repo.
	4.	Build settings:
	•	Framework preset: None
	•	Build command: (leave empty)
	•	Build output directory: / (root)
	5.	Deploy.

Cloudflare will assign:
	•	https://<project>.pages.dev

⸻

Custom Domain (Later)

When Asuntha buys a domain:
	1.	Cloudflare Pages → your project → Custom domains
	2.	Add the domain + follow DNS instructions
	3.	Update these in index.html:
	•	<link rel="canonical" href="https://YOURDOMAIN.com/">
	•	<meta property="og:url" content="https://YOURDOMAIN.com/">
	•	JSON-LD "url": "https://YOURDOMAIN.com/"

Also update:
	•	robots.txt → Sitemap: https://YOURDOMAIN.com/sitemap.xml
	•	sitemap.xml → <loc>https://YOURDOMAIN.com/</loc>

⸻

Notes (Cloudflare Pages Headers)

The _headers file is included to set:
	•	X-Content-Type-Options, Referrer-Policy, X-Frame-Options, Permissions-Policy
	•	Long-term caching for main.css, main.js, and images

⸻

Credits

Developed by Cavendish Pierre-Louis
https://cavendishpierrelouis.io
