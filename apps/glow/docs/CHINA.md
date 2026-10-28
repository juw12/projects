# Glow in mainland China: what the code does, and what it can't do

Not legal advice. Check with a lawyer or a local partner before offering Glow to the public in mainland China.

## Already handled in the app (1.21)

| Need | How Glow handles it | Where |
|---|---|---|
| Foreign models that don't serve China (OpenAI, Anthropic, Google, xAI) | Region CN shows only models from providers that serve China (DeepSeek, Qwen, GLM, Kimi, MiniMax, Seedream) plus open-weight GPT-OSS / Llama. Old chats can't send to a hidden model. | `web/shared/glow-locale.js` → `REGIONS.CN.allow` |
| Cross-border transfer consent (PIPL art. 39) | The first-run picker requires a separate consent tick for region CN before Glow can be used. Stored with a timestamp; changing region or deleting data withdraws it. | `CONSENT_REGIONS`, picker |
| Privacy notice in Chinese | `privacy.html#cn` (linked from the picker). | `web/privacy.html` |
| Keep data inside China | GlowChat Settings → "China AI providers": DeepSeek, Qwen (Alibaba Model Studio), Kimi (Moonshot), GLM (Zhipu) presets. Requests go straight from the browser to that provider. | `CHINA_PROVIDERS`, `chat/app.js` `fillChinaProviders` |
| Naming | A reader in mainland China (zh-CN + region CN) sees 中国台湾 / 中国香港、澳门; everyone else sees neutral names. | `MAINLAND_NAMES` |
| Network | The picker warns that Puter, Google, GitHub and the cloud browser may be blocked. A China-reachable cloud service can be set without code changes elsewhere. | `REGION_ENDPOINTS.CN.cloud` |

## Still needs you (not solvable in code)

1. **A China-reachable domain for the cloud worker.** `*.workers.dev` is commonly blocked. Bind the Glow cloud worker to your own domain
   (Cloudflare → Workers → Custom domains) and put it in `REGION_ENDPOINTS.CN.cloud`. For reliable access from China the domain/site normally
   needs hosting in mainland China, which requires an **ICP filing (ICP备案)** under a Chinese entity.
2. **Hosting the web app.** GitHub Pages (`juw12.github.io`) is reachable but slow or intermittently blocked. A mirror on a mainland host
   (Alibaba Cloud OSS, Tencent COS) also needs ICP filing.
3. **Glow AI sign-in.** Glow AI runs through Puter (USA), which may be unreachable. Users in China should use their own DeepSeek/Qwen/Kimi/GLM key
   (already in the app). Check whether those APIs accept requests from a browser page (CORS); if one doesn't, it needs a small proxy.
4. **Generative AI filing.** A generative AI service offered to the public in mainland China falls under the *Interim Measures for the
   Management of Generative AI Services* (2023): security assessment, algorithm filing and service registration with the CAC, done by a
   Chinese legal entity. Using registered Chinese models through their APIs helps but doesn't replace the service's own obligations.
5. **AI content labelling.** China's rules on labelling AI-generated content (in force since September 2025) expect visible and hidden
   labels on generated text and images. Glow doesn't add these yet.
6. **Real-name and content moderation duties** that apply to public services in China.

Until 1–4 are done, treat China support as "works for individual users with their own keys", not an official China launch.
