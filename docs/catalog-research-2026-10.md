# Catalogue research — October 2026

The owner asked to verify every product (real packages, what the customer must give, how it is delivered,
market prices) instead of relying on estimates, and to prepare selling through other suppliers. This is the
research behind catalog pack v5 (`apps/api/src/bootstrap/catalog-pack.ts`) and the customer guides
(`catalog-guides.ts`).

**Method and limits.** Web search across official pages and reputable resellers (Codashop, SEAGM, Midasbuy,
LikeCard, Eneba, Kinguin, MTCGame…), seen 2026-10-19. The research tools could not open pages directly, so
figures come from search-result extracts of the cited URLs; confidence is noted per brand. Re-check prices
with the chosen supplier before relying on a margin: sell prices are ~8–12% over the best reseller price.

## Decisions waiting for the owner

These products cannot be delivered the normal way from Mauritania; the usual "reseller" methods log into the
customer's account, use a foreign account or a family plan, which breaks the provider's terms and can get the
customer's account closed. They are still on sale, unchanged, until the owner decides:

- **YouTube Premium** — not offered in Mauritania; no gift card exists.
- **ChatGPT Plus** — OpenAI gift cards only work on US accounts; selling it by email means logging in.
- **Claude Pro** — Anthropic has paused gift subscriptions; no gift card.
- **Canva Pro** — no gift product; resellers add you to a team they own.
- **Netflix / Spotify / Disney+ / Apple Music "1 month"** — only possible by sharing an account; the
  gift cards (Netflix, Spotify) are the legitimate route, and must match the account's country/currency.
- **Riot (NA) cards** — Mauritanian players are on EU/MENA servers, where NA cards do not redeem.
- **Spotify US cards** — only work on accounts in the country of purchase.
- **TikTok coins** — official recharge credits only the logged-in account; no legitimate wholesale API was
  found. Prices are now near the official web price.

## Game top-ups

### PUBG Mobile (medium confidence)
- Delivery: Direct top-up to the numeric Character/Player ID (Midasbuy or a reseller doing a UID top-up), or a UC redeem code that the customer (or we) redeem on midasbuy.com against the same ID. Only the ID is needed, no password. On Midasbuy the region you pick must match the account; after you enter the ID, Midasbuy shows the nickname so you can check it. PUBG New State, BGMI (India) and the KR/JP/TW/VN versions use separate IDs and pages, so they are not covered by the Global product.
- Fixed/flagged: TOP-PUBG-1800 is priced at $25.50, above the official $24.99. The label is fine, but the price works against us unless we buy below about $22.70.
- Fixed/flagged: Labels should show the bonus split (e.g. '325 UC = 300+25'). Customers compare these in-game.
- Fixed/flagged: The 3850 and 8100 UC packs are missing; both are standard official tiers.
- Sources: <https://buffget.com/news/pubg-mobile-uc-top-up-prices-6-packs-cost-per-uc-2026>, <https://www.codashop.com/en-us/pubg-mobile-uc-redeem-code>, <https://www.seagm.com/pubg-mobile-uc-top-up-global>, <https://www.kopazar.com/en/pubg-mobile-uc>

### Free Fire (medium confidence)
- Delivery: Direct top-up to the numeric Player ID on Garena's top-up centre (shop.garena.sg/app), or a diamond code that is redeemed there with the Player ID. No password. Region-locked: the product's region (Global / MENA) must match the account's server. Resellers state that redeemed codes are non-refundable.
- Fixed/flagged: TOP-FF-310, TOP-FF-520 and TOP-FF-1060 are not Global/MENA packages. The MENA/Global tiers are 100+10, 210+21, 530+53, 1080+108 and 2200+220.
- Fixed/flagged: FF-DIAMONDS-100 is a stray duplicate priced at $11.50 for 100 diamonds (market price about $1.00). Remove it.
- Fixed/flagged: TOP-FF-100 at $1.05 is only $0.05 over cost. Raise it to $1.10.
- Fixed/flagged: We need to confirm which Free Fire server Mauritanian accounts are on (MENA is likely; unverified) and sell only that region's product.
- Sources: <https://ar-pay.com/en/product/free-fire-100-10-diamonds>, <https://ar-pay.com/en/product/free-fire-210-21-diamonds>, <https://ar-pay.com/en/product/free-fire-1080-108-diamonds>, <https://ar-pay.com/en/product/free-fire-2200-220-diamonds>

### Mobile Legends: Bang Bang (medium confidence)
- Delivery: Direct top-up to User ID + Zone ID (Codashop and resellers). No password, social login or OTP needed. Use the 'Global' product; region-specific products (e.g. Indonesia) exist separately.
- Fixed/flagged: Prices are well above market: TOP-MLBB-86 at $1.60 against a cost of about $1.21 (+32%), TOP-MLBB-706 at $12.50 against about $9.68 (+29%), and TOP-MLBB-257 at $4.70 against $3.62.
- Fixed/flagged: The 86/172/257/706 tiers are reseller ('web') tiers. In-app/Codashop-US tiers differ (some sources show 100/300/500/1000/1160…). Label the product 'Global web top-up' so customers don't compare it to in-app counts.
- Sources: <https://www.mtcgame.com/moonton/mobile-legends-bang-bang-diamond-top-up>, <https://www.mtcgame.com/moonton/mobile-legends-bang-bang-diamond-top-up/mobile-legends-86-diamonds-top-up>, <https://www.mtcgame.com/moonton/mobile-legends-bang-bang-diamond-top-up/mobile-legends-706-diamonds-top-up>, <https://elitedias.com/en/games/mobile-legends>

### Call of Duty: Mobile (medium confidence)
- Delivery: Direct top-up to the player UID on the official web store (store.callofdutymobile.com, run by Codashop) or a UID-only reseller. AVOID suppliers that complete the order by logging into the account (e.g. U7BUY says a UID alone is not enough for its CODM orders; some TopUpLive pages ask for the linked email). Pick a UID-only supplier so we never collect logins. The official US web store sells different pack sizes (460 / 960 / 2600 CP incl. bonus).
- Fixed/flagged: TOP-CODM-400 and TOP-CODM-800 are mislabelled. The real tiers are 420 CP (400+20) and 880 CP (800+80); CP counts shown in-game include the bonus.
- Fixed/flagged: TOP-CODM-400 at $5.25 is above the official $4.99, and TOP-CODM-800 at $10.30 is above the official $9.99.
- Fixed/flagged: Several cheap CODM sellers work through account login. Our supplier must be UID-only, and we must never ask for a password or email.
- Sources: <https://www.codashop.com/en-es/call-of-duty-mobile>, <https://store.callofdutymobile.com/en-us/codm>, <https://www.topuplive.com/codm/>, <https://www.topuplive.com/fr/codm/>

### Genshin Impact (medium confidence)
- Delivery: Direct top-up by UID + server (resellers; HoYoverse also runs an official web top-up, URL not verified here). No password needed. The server must match the UID. Mainland-China servers (UID starting 1/2/5) are a separate ecosystem and are not supported.
- Fixed/flagged: Prices are close to official, but we have no discounted supplier yet: real reseller discounts on Genshin are small or unverified, so the margin depends on the supplier.
- Fixed/flagged: Welkin is priced at $5.30, below the recommended $5.49 if bought at the official price. Fine if we have a supplier below about $4.80.
- Fixed/flagged: The server field should be derived and validated from the UID's first digit to prevent mismatches.
- Sources: <https://genshin-impact.fandom.com/wiki/Genesis_Crystal>, <https://gamewith.net/genshin-impact/article/show/22404>, <https://www.joytify.com/en-us/genshin-impact>, <https://www.xbox-now.com/en/dlc/13598/genshin-impact-blessing-of-the-welkin-moon>

### Yalla Ludo (medium confidence)
- Delivery: Direct top-up to the numeric Yalla Ludo ID (Codashop sells 'USD 5 (INT) - 2,320 Diamonds', 'USD 10 (INT) - 5,150 Diamonds'). Gold packs also exist. No password.
- Fixed/flagged: The SKU names say '$5/$10 top-up' but the product is a fixed diamond pack. Rename to '2,320 Diamonds' and '5,150 Diamonds'.
- Fixed/flagged: The 830-diamond ($2) entry tier is missing, and it is the most affordable.
- Sources: <https://www.codashop.com/en-qa/yalla-ludo>, <https://www.lootbar.com/top-up/yalla-ludo-ludo-jackaroo>, <https://www.enjoygm.com/top-up/yalla-ludo-ludo-jackaroo>, <https://www.gamebar.gg/top-up/yalla-ludo-ludo-jackaroo>

### Jawaker (medium confidence)
- Delivery: Direct top-up of tokens to the numeric Player Number (SEAGM, MTCGAME, VGTopup), or a token code redeemed on the official Jawaker site against the Player Number. No password.
- Fixed/flagged: The input field is wrong: the catalogue asks for [username], but Jawaker top-ups use the numeric Player Number.
- Fixed/flagged: The SKUs are named 'Jawaker tokens $5/$10'. Real packs are 32,500 and 70,000 tokens, so rename them. The 4,250-token ($1) tier is missing.
- Sources: <https://www.seagm.com/en-us/jawaker-token>, <https://www.mtcgame.com/jawaker/jawaker-top-up-global>, <https://www.mtcgame.com/jawaker/codes>, <https://www.joytify.com/en-us/jawaker-token>

### Bigo Live (medium-low confidence)
- Delivery: Direct recharge of diamonds to the Bigo ID (SEAGM, Joytify, TOPUPlive), or SEAGM's Bigo gift card (not available in the US). Only the Bigo ID is needed; any service asking for the Bigo password or OTP should be avoided. Web recharge is much cheaper than in-app (about $1.96 vs $3.14 per 100 diamonds per BitTopup, unofficial).
- Fixed/flagged: The input is [username]; it should be the Bigo ID.
- Fixed/flagged: '$5 / $10' are not real Bigo packages. Sell diamond counts (200 / 500).
- Fixed/flagged: The SKUs use an APP-* prefix with type GAME_TOPUP, unlike the other top-ups (TOP-*). This is cosmetic, but keep one convention.
- Sources: <https://www.seagm.com/bigo-live-diamonds>, <https://www.seagm.com/bigo-live-gift-card>, <https://www.joytify.com/en-us/bigo-live>, <https://www.topuplive.com/news/bigo-live-diamonds-price-guide.html>

## Apps and subscriptions

### TikTok Coins (medium confidence)
- Delivery: Official recharge (tiktok.com/coin) credits the account that is LOGGED IN; TikTok documents no official 'recharge another user by username' flow, and coins cannot be transferred between accounts. Legitimate reseller options: (a) TikTok Coins gift card / e-code (country-specific, e.g. SEAGM sells AE, DE, JP cards; the AE card is 'for UAE users only') which the customer redeems on the TikTok website; (b) a supplier that offers authorised direct top-up by TikTok ID/username (Codashop does this in Indonesia; not confirmed for MENA/West Africa). NEVER ask for the TikTok password or the SMS/2FA code - several 'username recharge' sellers actually ask for email+password, which is account-takeover risk and a ToS breach.
- Fixed/flagged: 70-coin pack does not exist on the official web store; replace with 30 Coins.
- Fixed/flagged: Missing official packs 3,500 / 7,000 (and 17,500). Official web set is 7 packs + custom amount: 30, 350, 700, 1400, 3500, 7000, 17500 (owner's question: TikTok has MORE packs than our 4).
- Fixed/flagged: All current prices are 39-60% above the official web price - far above the 'modest margin' target.
- Fixed/flagged: Type is GAME_TOPUP with [username]; a username-only top-up is not an official TikTok flow - only valid if the supplier offers authorised username top-up. Confirm with supplier before listing; never fall back to asking for passwords.
- Sources: <https://influencermarketinghub.com/tiktok-coin-recharge/>, <https://crowdfundly.com/blog/how-much-does-tiktok-coins-cost-in-usd-an-overall-guide>, <https://socialrails.com/blog/how-much-are-tiktok-coins-worth-complete-guide>, <https://www.lootbar.com/blog/en/what-can-you-use-a-tiktok-gift-card.html>

### Snapchat+ (medium confidence)
- Delivery: Two legitimate routes, no password needed: (1) In-app Gift Subscription sent from our Snapchat account to the customer's username - Snap's gifting terms REQUIRE the recipient to already be our Snapchat friend before purchase; terms offered are 3/6/12 months (no 1-month gift seen). (2) Snapchat+ gift card (e.g. US annual eGift $29.99 at Amazon/Best Buy) redeemed at snapchat.com/plus - must be redeemed in the SAME COUNTRY it was bought, recipient must not already have active Snapchat+. Gifts are non-refundable/non-transferable. Availability in Mauritania unverified (launch markets were US, CA, UK, FR, DE, AU, NZ, SA, AE; later expansion not confirmed this session).
- Fixed/flagged: 1-month Snapchat+ cannot be gifted (gift terms seen: 3/6/12 months) - remove SUB-SNAPPLUS-1M or make it a self-subscription guide only.
- Fixed/flagged: 12-month price $40 vs $29.99 US annual eGift reference.
- Fixed/flagged: Flow must include 'accept our friend request' step - username alone is not enough for in-app gifting.
- Fixed/flagged: Mauritania availability of Snapchat+ unverified.
- Sources: <https://www.snap.com/terms/gifting-terms>, <https://snap.com/terms/gift-card>, <https://newsroom.snap.com/snapchat-plus-gift-cards-2024>, <https://www.amazon.com/exec/obidos/ASIN/B0CN1KXC37/ref=nosim/0sil8>

### Telegram Premium (high confidence)
- Delivery: Gift to the customer's @username - no password. Official routes: (a) Fragment.com (run by the Telegram team, paid in TON; KYC required for the buyer) - 3/6/12-month gifts; (b) in-app gift paid with Telegram Stars (1,000 / 1,500 / 2,500 Stars for 3/6/12 months). Gift is a fixed term, does not auto-renew, and cannot be refunded once sent. Watch for phishing copies of Fragment.
- Fixed/flagged: Missing official 6-month term.
- Fixed/flagged: 12-month at $40 is above Fragment regular (~$35.99) and well above current sale (~$28.99).
- Fixed/flagged: Username regex should enforce Telegram rules (5-32 chars, letters/digits/underscore, starts with a letter).
- Sources: <https://gemwallet.com/learn/how-to-buy-telegram-premium-with-crypto-in-2026/>, <https://giftclub.app/blog/telegram-premium-price>, <https://tgsuperstars.com/en/telegram-premium/price/>, <https://news.dropstab.com/research/how-to-buy-telegram-premium-with-crypto>

### YouTube Premium (high confidence)
- Delivery: NOT SELLABLE LEGITIMATELY FOR MAURITANIA. Mauritania is not on Google's official list of YouTube Premium locations (list goes Malta -> ... -> Morocco, no Mauritania). In an unsupported country members lose benefits (downloads last 30 days); travelling >30 days or moving may get the subscription cancelled, and after ~6 months away it is suspended. There is NO YouTube Premium gift card: YouTube/Google Play gift cards only add Google Play balance, redeemed at youtube.com/redeem while signed in, and the Google account's country must match the card's. Family plan = the payer invites members (invite is not a code, family members must share the household). What resellers actually sell: (a) 'activation on your account' - they need your Google login (password) or make you change country via VPN; (b) grey '12-month codes/activation links' that only work on accounts that never had Premium and can't be cancelled; (c) seats in a family group they own. All three breach Google ToS and are at risk of cancellation. Recommend REMOVING this SKU.
- Fixed/flagged: SUB-YTPREMIUM-1M cannot be delivered legitimately to Mauritanian customers: service not offered in Mauritania, no YouTube Premium gift card exists, and reseller methods need the customer's Google password or VPN/region change. Remove (or hide for MR).
- Fixed/flagged: Price $8 is impossible at official rates (US $15.99/mo).
- Fixed/flagged: If kept for diaspora customers in supported countries, deliver a local-region Google Play gift card instead and let the customer subscribe themselves.
- Sources: <https://support.google.com/youtube/answer/6307365?hl=en>, <https://support.google.com/youtube/answer/7259382?hl=en>, <https://support.google.com/youtube/answer/9770906>, <https://en.wikipedia.org/wiki/YouTube_Premium>

### ChatGPT Plus (high confidence)
- Delivery: ChatGPT is officially supported in Mauritania, but there is no legitimate code a reseller can hand a Mauritanian customer: official OpenAI gift cards ($15-$250, sold by US retailers e.g. Best Buy, redeemed at chatgpt.com/redeem) work ONLY for US-based ChatGPT accounts in USD and not for App Store/Google Play billing. 'Gift credits' sent by Plus/Pro users are usage credits, not a Plus subscription. Plus is billed monthly ($20/mo US). Resellers that 'activate Plus on your email' log into the customer's account (need password or session) - avoid. An email alone is NOT enough to deliver Plus.
- Fixed/flagged: SUB-CHATGPT-1M with input [email] cannot be fulfilled without logging into the customer's account (password) - not acceptable.
- Fixed/flagged: OpenAI gift cards are US-account only; Mauritanian accounts cannot redeem them.
- Fixed/flagged: Price $24 vs official $20 - if ever sold, only as US gift card for US accounts.
- Sources: <https://help.openai.com/en/articles/20001491>, <https://help.openai.com/en/articles/20001417-gifting-credits-in-chatgpt>, <https://help.openai.com/en/articles/7947663-chatgpt-supported-countries>, <https://tariapay.com/gift/resources/openai-gift-card>

### Claude Pro (medium confidence)
- Delivery: The only official transferable product is a Claude gift subscription (redeemed on the web at claude.ai/gift/redeem, expires 365 days after purchase, can't be stacked; iOS/Google Play subscribers must wait until that subscription ends). Anthropic's help centre currently says gift subscriptions are UNAVAILABLE TO PURCHASE, with no date for return. There is no Claude retail gift card. Anthropic support warns that any service asking for your claude.ai password to 'activate' a subscription should be treated as a scam. Mauritania on Anthropic's supported-countries list: unverified (check anthropic.com/supported-countries).
- Fixed/flagged: Gift purchasing is paused by Anthropic, so SUB-CLAUDE-PRO-1M cannot currently be sourced legitimately - hide it.
- Fixed/flagged: Input [email] alone is fine for a gift link, but not for 'activation' services, which need the password.
- Fixed/flagged: Mauritania availability unverified.
- Sources: <https://support.claude.com/en/articles/12938627-how-to-gift-a-claude-subscription>, <https://support.claude.com/en/articles/12938695-how-to-redeem-a-claude-gift-subscription>, <https://halocard.co/blog/claude-gift-card>, <https://anthropic.com/supported-countries>

### Canva Pro (low confidence)
- Delivery: No official Canva Pro gift card / gift subscription found. Typical reseller method is inviting the customer's email into a Canva Team the reseller owns (no password needed, but the reseller controls the team and can see/remove the member's team content; likely against Canva terms). Some deals rely on buying via a cheap region (e.g. Nigeria VPN). Treat as grey-market; low confidence.
- Fixed/flagged: No official gift product; listing as a clean 12-month subscription is misleading. Disclose team-invite method or remove.
- Fixed/flagged: $125 is below the current reported official price ($144) - cannot be sourced at official price with margin.
- Sources: <https://pricingsaas.com/companies/canva/diffs/2026D254>, <https://moda.app/blog/canva-pricing>, <https://www.hotukdeals.com/deals/canva-pro-annual-subscription-via-nigeria-vpn-4790666>

### Discord Nitro (medium confidence)
- Delivery: Official gift link: we buy a 1-month or 1-year Nitro (or Nitro Basic) gift in Discord (desktop or mobile) and send the customer the gift link; they open it while logged in and claim. No password, no username needed. A gift link is refundable only while unclaimed, within 5 days. Avoid cheap marketplace 'keys' - users report Discord revoking flagged keys (Kinguin). Regional pricing in MENA/West Africa unverified.
- Fixed/flagged: 12-month at $105 is under the 8% margin floor vs official $99.99.
- Fixed/flagged: Nitro Basic (cheaper tier) missing.
- Sources: <https://support.discord.com/hc/articles/360020877112>, <https://www.solcard.cc/blog/buy-discord-nitro-with-crypto>, <https://remotewize.com/discord-pricing/>, <https://slickdeals.net/f/17517564-1-year-discord-nitro-digital-delivery-46-18>

### Netflix (medium confidence)
- Delivery: Sell GIFT CARDS, not 'subscriptions'. Netflix help: gift cards can be used only for a Netflix streaming subscription, and a card bought in another country CAN be used if it matches the currency of the member's bill. So a US (USD) card works for a Mauritanian account only if that account is billed in USD (Mauritania billing currency unverified - test one card first). A '1 month Netflix' with no inputs can only be fulfilled by sharing a reseller-owned account login (against Netflix terms, password sharing) - remove.
- Fixed/flagged: SUB-NFLX-1M (no inputs) can only be delivered as a shared account = password sharing; remove and point to gift cards.
- Fixed/flagged: Gift card usability for MR depends on the account's billing currency (unverified); add a pre-purchase check.
- Sources: <https://help.netflix.com/en/node/32950>, <https://www.mygiftcardsupply.com/buy-netflix-gift-card/us/>, <https://topuplist.com/product/netflix-gift-card>

### Spotify Premium (medium confidence)
- Delivery: Spotify (Free + Premium) has been available in Mauritania since the Feb 2021 expansion. Gift cards are redeemable ONLY where the account's country matches the card's country of purchase; US cards require the user to reside in the US, can't be used for Premium Family or with other promos, and are for standalone Premium bought on spotify.com. No Mauritania-issued Spotify gift card found. Therefore 'Spotify Premium N months' cannot be delivered by code to an MR account; reseller alternatives are family-plan invites (Family requires same address - ToS risk) or logging into the customer account (password) - avoid. Keep US gift cards only for US-account customers.
- Fixed/flagged: SUB-SPOTIFY-1M/3M/12M (no inputs) cannot be fulfilled legitimately for Mauritanian accounts - region-locked cards, no MR card; remove or relabel as 'US gift card'.
- Fixed/flagged: GC-SPOTIFY-US-* must state 'US accounts only'. Add $60 face value; US denominations are $10/$30/$60.
- Sources: <https://techcrunch.com/2021/02/22/spotify-to-expand-international-footprint-across-85-new-markets>, <https://musicinafrica.net/node/153587>, <https://community.spotify.com/t5/Accounts/I-was-given-a-gift-card-bought-in-a-different-country-than-my/m-p/4877218>, <https://www.eneba.com/gb/store/spotify-gift-cards>

### Shahid VIP (low confidence)
- Delivery: MBC's Shahid sells VIP vouchers/codes via MENA resellers; customer redeems the code on shahid.mbc.net while logged in - no password. Codes are typically region-specific (e.g. KSA/UAE/Egypt) - confirm Mauritania/MENA validity. [unverified - web search budget exhausted before this brand could be checked; guidance below is from prior general knowledge and MUST be confirmed before listing]
- Fixed/flagged: Packages and prices unverified; confirm voucher region works for Mauritanian accounts.

### OSN+ (low confidence)
- Delivery: OSN+ is a MENA streaming service; resellers sell prepaid vouchers redeemed on osnplus.com. Mauritania coverage and voucher availability not confirmed. [unverified - web search budget exhausted before this brand could be checked; guidance below is from prior general knowledge and MUST be confirmed before listing]
- Fixed/flagged: Price/packages unverified; Mauritania availability unverified.

### Anghami Plus (low confidence)
- Delivery: Anghami sells Plus vouchers/gift codes in MENA, redeemed in the app/website while logged in - no password. Region of voucher must be confirmed. [unverified - web search budget exhausted before this brand could be checked; guidance below is from prior general knowledge and MUST be confirmed before listing]
- Fixed/flagged: Prices unverified.

### Disney+ (low confidence)
- Delivery: Disney+ has no general gift card in MENA to our knowledge; Mauritania was not believed to be a Disney+ MENA launch market, and Disney content in MENA has been moving to OSN+. A '1 month' with no inputs implies account sharing. [unverified - web search budget exhausted before this brand could be checked; guidance below is from prior general knowledge and MUST be confirmed before listing]
- Fixed/flagged: Likely not legitimately sellable for Mauritania; confirm availability before keeping SUB-DISNEY-1M.
- Fixed/flagged: No-input subscription implies shared credentials - remove unless a code product exists.

### Apple Music (low confidence)
- Delivery: Apple Music is paid from Apple Account balance; Apple Gift Cards are redeemable only in the country of purchase, so a US card needs a US Apple Account. Deliver as an Apple Gift Card of the customer's Apple Account region, not as a '1 month' subscription. [unverified - web search budget exhausted before this brand could be checked; guidance below is from prior general knowledge and MUST be confirmed before listing]
- Fixed/flagged: SUB-APPLEMUSIC-1M with no inputs cannot be delivered as such; sell region-matched Apple Gift Cards instead.
- Fixed/flagged: Mauritania Apple Music pricing unverified.

### Microsoft 365 Personal / Family (low confidence)
- Delivery: Delivered as a 25-character product key (ESD), redeemed at microsoft365.com/setup into the customer's Microsoft account - no password to us. Keys are often region-restricted (e.g. 'Eurozone', 'US', 'Middle East'); choose a region the customer's Microsoft account can redeem. Family = up to 6 people shared by the owner. [unverified - web search budget exhausted before this brand could be checked; guidance below is from prior general knowledge and MUST be confirmed before listing]
- Fixed/flagged: Prices unverified; our $105/$135 should be checked against current official and key-reseller prices.
- Fixed/flagged: Region of key must be stated.

### Xbox Game Pass Ultimate (low confidence)
- Delivery: Delivered as a region-locked code redeemed at xbox.com/redeem on the customer's Microsoft account (no password). Xbox account region must match the code region; Mauritania is not believed to be an official Xbox market, so customers typically use a US/other-region account. [unverified - web search budget exhausted before this brand could be checked; guidance below is from prior general knowledge and MUST be confirmed before listing]
- Fixed/flagged: Price unverified (Microsoft repriced Game Pass tiers in 2025; re-check).
- Fixed/flagged: State code region.

### PlayStation Plus Essential (low confidence)
- Delivery: Delivered as a region-locked PSN voucher (or via PSN wallet card) redeemed on the customer's PSN account (Settings > Redeem codes) - no password. Mauritania is not a PSN country; customers use e.g. US/UAE/KSA accounts, so the code region must match the account region. [unverified - web search budget exhausted before this brand could be checked; guidance below is from prior general knowledge and MUST be confirmed before listing]
- Fixed/flagged: 1-month Essential vouchers may not be sold in all regions (3/12-month more common) - unverified.
- Fixed/flagged: State code region; price unverified.

## Gift cards

### Apple Gift Card (US) / App Store & iTunes (medium confidence)
- Delivery: Digital code (16 characters, starts with X). Redeem it yourself in the App Store. No password needed from the customer. Works only on an Apple Account whose country/region is United States, with no currency conversion.
- Fixed/flagged: Apple US cards sell above face value at resellers (SEAGM about +2.5%). With current prices of $10.90, $26.90, $53.50 and $106, the $50 and $100 cards make well under 8% over cost. Use the recommended prices.
- Fixed/flagged: No input is collected. Add a confirmation that the account region is US, because this is the most common reason for complaints.
- Sources: <https://www.seagm.com/apple-gift-card-us>, <https://www.eneba.com/store/apple-gift-cards>, <https://www.g2a.com/apple-gift-card-25-usd-apple-key-united-states-i10000338397024>, <https://en.likecard.com/app-stores/itunes/itunes-usa/>

### Google Play (US) (medium confidence)
- Delivery: Digital code. Redeem at play.google.com/redeem. No password needed. The card only works if the customer's Google Play country is United States.
- Fixed/flagged: Likely to cause many failed redemptions in Mauritania: Play gift cards are tied to the Play country, and customers cannot set it to US without being in the US with a US payment method. Keep these cards only with the region confirmation and a clear warning, or mark them 'for US Play accounts only'.
- Fixed/flagged: $10 at $10.90 is below the recommended $11.20. $25 at $26.80 and $50 at $53.00 are close to the recommended prices.
- Sources: <https://www.seagm.com/en-us/google-play-gift-card-united-states>, <https://www.eneba.com/us/store/google-play-gift-cards>, <https://support.google.com/googleplay/answer/11564359>, <https://support.google.com/googleplay/answer/3422734>

### PlayStation Store (US) (medium confidence)
- Delivery: Digital 12-character voucher code. Redeem on the console or the PlayStation Store website. No password needed. Only works on a PSN account whose region is United States.
- Fixed/flagged: No region confirmation is collected. Many MENA players use UAE or Saudi PSN accounts, where US cards do not work. Ask for the region, or offer other regions later.
- Fixed/flagged: Current prices of $10.90, $26.90 and $53.50 are close to the recommended ones.
- Sources: <https://www.eneba.com/store/psn-gift-cards>, <https://www.kinguin.net/category/3292/playstation-network-card-10-us>, <https://en.likecard.com/game-cards/playstationcards/>, <https://insider-gaming.com/countries-that-dont-have-psn/>

### Xbox Gift Card (US) (medium confidence)
- Delivery: Digital 25-character code. Redeem at redeem.microsoft.com or on the console. No password needed. Only works on a Microsoft account whose country is United States and currency is USD.
- Fixed/flagged: Overpriced: Xbox US cards sell below face value ($15 at $14.10, $25 at $23.50 on SEAGM). Current prices of $16.30 and $26.90 are above the recommended $15.51 and $25.38.
- Fixed/flagged: Consider adding $50.
- Sources: <https://www.seagm.com/xbox-live-gift-cards-united-states>, <https://www.eneba.com/us/store/xbox-gift-cards>, <https://dundle.com/xbox/20-usd-us/>, <https://learn.microsoft.com/en-us/answers/a/12642218>

### Steam Wallet (USD) (medium confidence)
- Delivery: Digital wallet code. Redeem at store.steampowered.com/account/redeemwalletcode. No password needed. The code currency must match the Steam account currency.
- Fixed/flagged: Steam USD codes trade slightly above face value. $20 at $21.60 is below the recommended $23.02, and $50 at $53.50 is below $54.90 (about 5% margin).
- Fixed/flagged: The catalogue name says 'Steam Wallet $20' without a currency. Name it 'Steam Wallet $20 (USD)' and add the currency confirmation.
- Sources: <https://www.seagm.com/en-in/steam-wallet-card-code-global>, <https://help.steampowered.com/faqs/view/2720-4EC7-B95A-1D2A>, <https://steamcommunity.com/discussions/forum/1/4031346570757256856>, <https://steamcommunity.com/discussions/forum/1/727997287883672248>

### Nintendo eShop (US) (medium confidence)
- Delivery: Digital 16-character code. Redeem on the Switch eShop or at ec.nintendo.com/redeem. No password needed. Only works on a Nintendo Account whose country is United States.
- Fixed/flagged: Overpriced: the $20 card costs about $18.04 (SEAGM). The current $21.60 is above the recommended $19.84.
- Fixed/flagged: Only $20 is listed. Add the other official denominations: $10, $35 and $50.
- Sources: <https://www.seagm.com/en-us/nintendo-eshop-prepaid-us>, <https://www.eneba.com/us/store/nintendo-gift-cards>, <https://www.bitrefill.com/buy/nintendo-usa/>, <https://www.g2a.com/nintendo-eshop-card-20-usd-nintendo-eshop-key-north-america-i10000006097011>

### Roblox Gift Card (medium confidence)
- Delivery: Digital PIN. Redeem in a web browser at roblox.com/redeem. No password needed. Since March 2024 Roblox gift cards are no longer region-locked: credit converts to the account currency with no fees.
- Fixed/flagged: Overpriced: SEAGM sells the $10 and $25 cards at $9.20 and $23.00. Current prices of $10.90 and $26.90 are above the recommended $10.12 and $24.84.
- Fixed/flagged: Consider adding $50.
- Sources: <https://www.seagm.com/roblox-game-card-us>, <https://www.dexerto.com/roblox/roblox-gift-cards-no-longer-region-locked-2612524>, <https://www.g2a.com/news/features/roblox-price-robux-cost-per-dollar-guide/>, <https://www.g2a.com/roblox-card-10-usd-roblox-key-global-i10000036816012>

### Razer Gold (Global USD PIN) (medium confidence)
- Delivery: Digital PIN. Reload at gold.razer.com (Reload → Razer Gold PIN), or use it directly in partner game top-ups. No password needed from the customer. SEAGM: the Global PIN tops up the Razer GLOBAL wallet (USD) or reloads games directly.
- Fixed/flagged: Prices of $10.60, $26.30 and $52.30 make about 4.6–6% over a face-value cost. The recommended prices are $11.00, $27.00 and $54.00.
- Fixed/flagged: Name them 'Razer Gold Global (USD)' so customers don't buy them for a regional wallet.
- Sources: <https://www.seagm.com/en-us/razer-gold-usd-global>, <https://www.seagm.com/en-in/razer-gold-usd-global>, <https://www.eneba.com/us/store/razer-gold-gift-cards>, <https://coingate.com/en/gift-cards/articles/article/how-to-redeem-a-razer-gold-gift-card>

### Riot Games Gift Card (LoL / Valorant), NA (medium confidence)
- Delivery: Digital code, redeemed in the game client (Store → Prepaid cards & codes). No password needed. Cards are tied to a region/server: Riot says US or Canada cards only redeem on the NA server.
- Fixed/flagged: WRONG FIT: GC-RIOT-10/25/50 are NA-only cards, but Mauritanian players are mostly on EU or ME servers, where they cannot be redeemed. Remove them, or relabel as 'NA server only' with a region select. Replace with direct VP/RP top-up to a Riot ID.
- Fixed/flagged: The current name 'Riot Games Gift Card $10 (League of Legends…)' doesn't say the card is region-locked.
- Sources: <https://support.riotgames.com/en-us/riot/events/prepaid-gift-cards>, <https://support.riotgames.com/en-us/riot/store/prepaid-cards-cash-codes-content-codes>, <https://support.riotgames.com/en-us/riot/account/methods-of-payment>, <https://support-teamfighttactics.riotgames.com/hc/articles/29268172644499>

### Blizzard Battle.net Balance (USD) (medium confidence)
- Delivery: Digital code. Redeem at battle.net/balance (log in and enter the code). No password needed. The card currency must equal the Battle.net Shop currency, which is set by the account's Country of Residence.
- Fixed/flagged: $20 at $21.60 is a bit over the recommended $20.24 (cost $18.40). $50 at $53.50 is above the recommended $52.38.
- Fixed/flagged: No currency confirmation is collected, and the currency of Mauritania-registered Battle.net accounts is unverified.
- Sources: <https://www.seagm.com/en-us/battlenet-balance-card-united-states>, <https://eu.support.blizzard.com/en/article/32784>, <https://warcraft.wiki.gg/wiki/Blizzard_Balance>, <https://www.eneba.com/us/store/blizzard-gift-card>

### Fortnite V-Bucks / Fortnite Gift Card (medium confidence)
- Delivery: Code. V-Bucks cards are redeemed at fortnite.com/vbuckscard. The newer Fortnite gift cards add money to the Epic account balance at epicgames.com/redeem. No password needed. Both are region-locked to the Epic account country.
- Fixed/flagged: WRONG: 'Fortnite 1,000 V-Bucks' no longer exists. Since 19 March 2026 the $8.99 pack is 800 V-Bucks.
- Fixed/flagged: WRONG FIT: V-Bucks and Fortnite cards are locked to the Epic account country, and Epic does not allow changing the country to redeem. Mauritania is not a card region, so most local customers cannot redeem a US card.
- Fixed/flagged: Price $9.60 for something sold officially at $8.99, with no confirmed supplier cost.
- Sources: <https://fortnitehelp.epicgames.com/help/th/c-Category_Fortnite/c-Fortnite_BillingSupport/are-v-bucks-gift-cards-region-locked-a000085824>, <https://www.epicgames.com/help/c-202300000001636/c-202300000001723/can-i-change-the-country-on-my-account-in-order-to-redeem-a-v-bucks-card-from-another-country-a202300000012424>, <https://www.fortnite.com/vbuckscard>, <https://www.fortnite.com/news/fortnite-gift-cards-a-new-way-to-buy-v-bucks-games-and-more>

### Minecraft (Minecoins & Java + Bedrock Edition) (medium confidence)
- Delivery: Digital code. The Java & Bedrock (PC) key is redeemed at minecraft.net/redeem on a Microsoft account. Minecoins codes are redeemed in Minecraft Bedrock / Microsoft Store (redeem.microsoft.com). No password needed.
- Fixed/flagged: WRONG PRICE: Java & Bedrock is listed at $31.50, above the official $29.99. The market price is about $19. Recommended sell is $20.50 with a GLOBAL key, or at most $29.99.
- Fixed/flagged: Minecoins 1,720 at $10.60 is above the about $9.99 retail price. Recommended is $8.38.
- Fixed/flagged: Add a platform input for Minecoins.
- Sources: <https://www.walmart.com/c/kp/minecraft-bucks>, <https://sportskeeda.com/minecraft/how-much-minecraft-cost-pc>, <https://www.eneba.com/store/minecraft-minecoins>, <https://www.eneba.com/promo/minecraft-games>

### Amazon.com Gift Card (US) (medium confidence)
- Delivery: Digital claim code. Redeem at amazon.com/redeem (Your Account → Gift Cards). No password needed. Works only on Amazon.com, not on Amazon.ae, .de, .co.uk or other Amazon sites.
- Fixed/flagged: $25 at $27.00 is close to the recommended $27.54. $50 at $53.50 is under the recommended $55.08 (about 4.9% over the SEAGM cost).
- Sources: <https://www.seagm.com/en-us/amazon-gift-card-united-states>, <https://www.eneba.com/us/store/amazon-gift-cards>, <https://kinguin.net/category/13946/amazon-25-gift-card-us>, <https://help.rybbon.net/hc/en-us/articles/360017689191-Can-I-use-my-Amazon-com-Gift-Card-with-International-Amazon-Sites>

### Netflix Gift Card (US) (low confidence)
- Delivery: Digital PIN. Redeem at netflix.com/redeem. No password needed. The card's currency must equal the currency of the customer's Netflix bill.
- Fixed/flagged: Prices of $26.90 and $53.50 are slightly under the recommended $27.24 and $54.00.
- Fixed/flagged: Unverified: whether Netflix bills Mauritanian accounts in USD. Run a test redemption before promoting.
- Sources: <https://www.seagm.com/netflix-gift-card-united-states>, <https://help.netflix.com/node/32950>, <https://help.netflix.com/legal/giftterms>, <https://www.eneba.com/us/store/netflix-gift-cards>

### Spotify Gift Card (US) (medium confidence)
- Delivery: Digital code. Redeem at spotify.com/redeem. No password needed. Only for full-price Premium Individual (not Family, Duo, Student or trials). Must be redeemed within 12 months of purchase.
- Fixed/flagged: WRONG FIT: Spotify US cards need a US Spotify account (country of purchase rule), so a Mauritanian resident cannot legitimately redeem them. Remove them, or sell only to customers who state they have a US account.
- Fixed/flagged: SOLD BELOW COST: the $10 card at $10.90 and the $30 card at $32.00 are below the reseller cost of about $11.51 and $33.26.
- Sources: <https://www.spotify.com/in-en/legal/gift-card>, <https://www.spotify.com/nz/gift-card>, <https://www.g2a.com/spotify-gift-card-10-usd-spotify-united-states-i10000000516006>, <https://www.g2a.com/spotify-gift-card-30-usd-spotify-united-states-i10000000516007>

### Twitch Gift Card (US) (low confidence)
- Delivery: Digital code. Redeem at twitch.tv/redeem. Adds Twitch gift balance for subs, gift subs and Bits. No password needed.
- Fixed/flagged: Possible WRONG FIT: reseller terms say US Twitch cards are for US residents only. Test on a Mauritanian account before keeping them, otherwise remove.
- Fixed/flagged: $25 at $26.90 is slightly under the recommended $27.41. $50 at $53.50 is close to the recommended $54.00.
- Sources: <https://www.seagm.com/twitch-gift-card-us>, <https://en.likecard.com/video-streaming/twitch/twitch-50.html>, <https://www.gifq.com/brands/twitch-usa>, <https://help.fluz.app/en/articles/5708630-twitch>

## Crypto top-ups and phone credit

### USDT top-up (Binance UID or BEP20) (medium confidence)
- Delivery: Shop sends USDT from its own Binance account: (a) Binance internal transfer to the customer's Binance ID/UID (no fee, instant, off-chain), or (b) on-chain withdrawal on BNB Smart Chain (BEP20) to the customer's 0x… address (withdrawal fee ~0.01 USDT per several 2026 third-party fee tables; one lists 0.29). No password ever needed.
- Fixed/flagged: Not in the current catalogue (new product).
- Fixed/flagged: Do not label the input 'Binance Pay ID': Binance retired Pay ID; use 'Binance ID (UID)'.
- Sources: <https://www.binance.com/en-ZA/support/faq/how-to-find-my-binance-pay-id-f3040335259a4b1ea68934daf94bab1d>, <https://www.binance.com/en-TR/support/faq/binance-pay-frequently-asked-questions-3cd54320f57d45f6a0de711e9ee98ab0?hl=en-TR>, <https://www.binance.com/en/support/faq/e36df8b437cb43e3909e7a38f8867957>, <https://www.binance.com/en-NG/support/faq/115003764971>

### KAST card top-up (kast.xyz) (medium confidence)
- Delivery: Shop sends USDT to the customer's KAST 'Receive' address on the network the customer picked (recommended: BNB Chain/BEP20 from Binance, ~0.01 USDT fee). KAST credits stablecoins 1:1 with 0% KAST deposit fee (network fee excluded). Alternative if the shop keeps a KAST balance: free instant KAST-to-KAST transfer by KAST Tag / email / phone. No password needed.
- Fixed/flagged: Not in the current catalogue (new product).
- Fixed/flagged: Availability for Mauritanian residents is unverified — confirm with KAST Concierge before advertising.
- Sources: <https://concierge.kast.xyz/hc/en-us/articles/13973209755663-What-Tokens-and-Blockchains-Does-KAST-Support>, <https://concierge.kast.xyz/hc/en-us/articles/11784729022863-Which-Stablecoins-Are-Supported-on-the-KAST-App>, <https://concierge.kast.xyz/hc/en-us/articles/13818934627727-How-Do-I-Fund-My-KAST-Account>, <https://concierge.kast.xyz/hc/en-us/articles/11784270850575-What-are-Some-Important-Tips-to-Keep-In-Mind-Before-Depositing-to-KAST>

### RedotPay card top-up (medium confidence)
- Delivery: Preferred: RedotPay internal transfer by the customer's RedotPay UID (free, instant, irreversible; both sides KYC-verified) if the shop holds a RedotPay balance. Otherwise on-chain USDT deposit to the customer's RedotPay address (BEP20 from Binance ~0.01 USDT, or TRC20). No password needed.
- Fixed/flagged: Not in the current catalogue (new product).
- Sources: <https://helpcenter.redotpay.com/en/articles/10339284-how-to-deposit-cryptocurrency-to-my-redotpay-account>, <https://helpcenter.redotpay.com/en/articles/10693364-supported-cryptocurrencies-networks-minimum-deposits>, <https://helpcenter.redotpay.com/en/articles/10339288-deposit-not-received-wrong-network-or-coin>, <https://helpcenter.redotpay.com/en/articles/11990987-3-what-deposit-methods-are-supported>

### Mauritel (Moov) airtime (Mauritania) (medium confidence)
- Delivery: Direct airtime credit to the phone number. Cheapest source for a Mauritania-based shop: local channels (operator dealer account, or the shop's Bankily / Masrvi wallet, which sell phone credit for any number). International APIs (Ding, Bitrefill, doctorSIM, BOSS Revolution, Rebtel, Monisnap, Tasonic) cover the operator but retail at far above face value (Tasonic ~USD 2.24 for ~45 MRU), so use them only for USD-paying diaspora customers. No password.
- Fixed/flagged: Current sell prices (2.51/5.03/12.56/25.13) are face value at ~39.8 MRU/USD — i.e. zero margin unless the owner gets a dealer discount.
- Fixed/flagged: Type is GAME_TOPUP; airtime should be its own type/category (e.g. MOBILE_TOPUP) for correct UI and reporting.
- Fixed/flagged: Input [phone] has no operator-prefix validation; add the regex so a Mattel number cannot be sent to the Mauritel product.
- Sources: <https://www.itu.int/dms_pub/itu-t/oth/02/02/T02020000870001PDFF.pdf>, <https://en.wikipedia.org/wiki/Telephone_numbers_in_Mauritania>, <https://www.ouestaf.com/nouvelle-numerotation-telephonique-en-mauritanie-tous-les-reseaux-passent-de-sept-a-huit-chiffres/>, <https://www.ding.com/countries/africa/mauritania>

### Mattel airtime (Mauritania) (medium confidence)
- Delivery: Direct airtime credit to the phone number. Cheapest source for a Mauritania-based shop: local channels (operator dealer account, or the shop's Bankily / Masrvi wallet, which sell phone credit for any number). International APIs (Ding, Bitrefill, doctorSIM, BOSS Revolution, Rebtel, Monisnap, Tasonic) cover the operator but retail at far above face value (Tasonic ~USD 2.24 for ~45 MRU), so use them only for USD-paying diaspora customers. No password.
- Fixed/flagged: Current sell prices (2.51/5.03/12.56/25.13) are face value at ~39.8 MRU/USD — i.e. zero margin unless the owner gets a dealer discount.
- Fixed/flagged: Type is GAME_TOPUP; airtime should be its own type/category (e.g. MOBILE_TOPUP) for correct UI and reporting.
- Fixed/flagged: Input [phone] has no operator-prefix validation; add the regex so a Mattel number cannot be sent to the Mauritel product.
- Sources: <https://www.itu.int/dms_pub/itu-t/oth/02/02/T02020000870001PDFF.pdf>, <https://en.wikipedia.org/wiki/Telephone_numbers_in_Mauritania>, <https://www.ouestaf.com/nouvelle-numerotation-telephonique-en-mauritanie-tous-les-reseaux-passent-de-sept-a-huit-chiffres/>, <https://www.ding.com/countries/africa/mauritania>

### Chinguitel airtime (Mauritania) (medium confidence)
- Delivery: Direct airtime credit to the phone number. Cheapest source for a Mauritania-based shop: local channels (operator dealer account, or the shop's Bankily / Masrvi wallet, which sell phone credit for any number). International APIs (Ding, Bitrefill, doctorSIM, BOSS Revolution, Rebtel, Monisnap, Tasonic) cover the operator but retail at far above face value (Tasonic ~USD 2.24 for ~45 MRU), so use them only for USD-paying diaspora customers. No password.
- Fixed/flagged: Current sell prices (2.51/5.03/12.56/25.13) are face value at ~39.8 MRU/USD — i.e. zero margin unless the owner gets a dealer discount.
- Fixed/flagged: Type is GAME_TOPUP; airtime should be its own type/category (e.g. MOBILE_TOPUP) for correct UI and reporting.
- Fixed/flagged: Input [phone] has no operator-prefix validation; add the regex so a Mattel number cannot be sent to the Mauritel product.
- Sources: <https://www.itu.int/dms_pub/itu-t/oth/02/02/T02020000870001PDFF.pdf>, <https://en.wikipedia.org/wiki/Telephone_numbers_in_Mauritania>, <https://www.ouestaf.com/nouvelle-numerotation-telephonique-en-mauritanie-tous-les-reseaux-passent-de-sept-a-huit-chiffres/>, <https://www.ding.com/countries/africa/mauritania>

## Suppliers to buy from automatically (AUTO_PROVIDER)

Method caveat: on 2026-10-19 this sandbox's egress proxy blocked direct page fetches, so every fact comes from WebSearch result extracts of the cited URLs. Re-check them on the live pages before signing anything. Start with three suppliers. (1) Reloadly as the primary integration. It is the only candidate here with confirmed self-serve sign-up, a sandbox with test credit, USDT/USDC TRC20 funding and a 100 USD minimum top-up. It covers gift cards (including some Free Fire diamond SKUs) and international airtime in one REST integration. Mauritania is not on its sanctions list, but test MR operator and gift-card coverage in the sandbox before building on it. (2) LikeCard as the regional MENA catalogue: 3000+ cards including PUBG, an Arabic-market focus, a no-inventory prepaid-balance merchant model and advertised commission up to 25%. Ask for the official API docs and confirm Mauritania eligibility. (3) EZ PIN as the second wholesaler: a documented REST V2 vendor API with webhooks and a sandbox, Middle East and Africa coverage, and a multi-currency wallet. The minimum deposit is set by tier. For direct in-game top-up by player ID (PUBG UC, Free Fire, MLBB), apply to SEAGM's partner API as a follow-up; its documented OpenAPI covers direct top-up paid from SEAGM Credits. For Mauritanian phone credit, use Reloadly if MR is supported, otherwise DingConnect, which lists +222 in its partner country options and takes card or bank funding. No legitimate wholesale API for TikTok coins was found. Sources describe unofficial TikTok coin supply as high-risk (bans and chargebacks), so treat TikTok as unsupported until a supplier shows authorized supply. Avoid Smile.one unofficial APIs, Kinguin/G2A grey-market keys and region-locked SEA suppliers such as Lapakgaming. Given the existing AUTO_PROVIDER mode, implement each supplier as a provider adapter (order, status poll, webhook, balance check). Keep a low-balance alert on each prepaid wallet, because every candidate is pre-funded.

- **Reloadly** (good) — International airtime and data top-up (Reloadly says 600+ operators; a third-party review says 150+ countries), Gift cards (catalog filtered by country ISO code; samples show Free Fire diamond product. Funding: Wire transfer, ACH, credit card and crypto. The support page lists BTC, ETH, USDT and USDC (ERC20 and TRC20) and Binance Pay; its screenshots date from 2024. Mi. <https://www.reloadly.com>
- **EZ PIN** (good) — Digital gift cards and game cards: iTunes, Google Play, PSN, Xbox, Steam, Nintendo, PUBG, Fortnite and more (per a third-party article), Physical card activation, Direct PUBG UC or Free Fire top-up by. Funding: Pre-funded e-wallet with multi-currency balances. The minimum deposit depends on reseller tier, target markets and volume; no figure is published. Payment metho. <https://ezpin.com>
- **LikeCard (Like4Card)** (good) — 3000+ prepaid cards: iTunes, Google Play, PlayStation, PUBG, top-ups, game cards, VOD and shopping cards, Direct game top-up by player ID: unverified, TikTok coins: unverified, Mauritanian airtime: un. Funding: Prepaid merchant balance that you replenish ('Simply replenish your LikeCard account'). LikeCard says unused balance is returned. Payment methods (bank, USDT): . <https://likecard.com/business/become-merchant>
- **DingConnect (Ding / Ezetop)** (maybe) — International mobile top-up (airtime and data bundles), Gift vouchers and bill payments (per Ding marketing), Mauritanian airtime: Mauritania (+222) appears in the partner-agreement country options, b. Funding: Self-fund by Visa, Mastercard or PayPal (where the currency is supported; first card use is manually verified), or by bank transfer using details from the BD te. <https://www.dingconnect.com>
- **DT One (DVS API / DT Shop)** (maybe) — Mobile airtime and data across a partner network in about 180 countries, Other digital value products (DVS), Mauritanian operators: unverified, Game top-ups and gift cards: unverified. Funding: Unverified.. <https://www.dtone.com>
- **SEAGM (partner / OpenAPI)** (maybe) — Digital codes, Direct top-up for mobile games (exact titles such as PUBG, Free Fire or MLBB by player ID: unverified), TikTok coins: unverified. Funding: All API purchases are paid from your account balance in SEAGM Credits. How to fund credits (bank, crypto): unverified.. <https://corp.seagm.com/>
- **UniPin** (maybe) — In-game top-up by player ID (validate user, then create order), UniPin Credits / vouchers, TikTok coins: unverified, Gift cards and airtime: unverified. Funding: Unverified.. <https://www.unipin.com>
- **Bitaqaty Business (OneCard / Gulf Direct Distribution)** (maybe) — Digital cards and vouchers (MENA catalog), Specific titles, direct top-up, TikTok and airtime: unverified. Funding: Unverified.. <https://v2docs.onecard.com/>
- **Razer Gold (Distribution Partners)** (poor) — Razer Gold e-PINs (usable across many games). Funding: Unverified.. <https://partners.gold.razer.com/en/distribution-partners>
- **Smile.one** (poor) — Mobile Legends (MLBB) diamonds and other game top-ups (consumer storefront). Funding: Unverified.. <https://www.smile.one>
- **MTCGame** (maybe) — Game codes, in-game currency, gift cards (sourced through publisher APIs and authorized distributors). Funding: Unverified.. <https://www.mtcgame.com>
- **Lapakgaming / Joytify** (poor) — Game top-ups (PUBG, Free Fire), gift cards, subscriptions. Funding: Initial deposit required. Methods: unverified.. <https://www.lapakgaming.com/en-my/reseller>
- **PrepaidForge** (maybe) — 1800+ digital products: gift cards, game keys, prepaid top-ups. Funding: Unverified (no crypto mention found).. <https://prepaidforge.com/>
- **OffGamers** (poor) — Game cards, game keys, vouchers, airtime (B2C). Funding: Unverified.. <https://www.offgamers.com>
- **Kinguin / G2A (marketplaces)** (poor) — Game keys and gift cards from marketplace sellers. Funding: Unverified.. <https://kinguin-seller-hub.document360.io/docs/publicapidocumentationv2>
- **GiftCard Partners** (poor) — 300+ (mostly US) gift card brands, plastic and eGift, for corporate incentives. Funding: Funded from a single account (unverified detail).. <https://www.giftcardpartners.com/gift-card-api>
- **Tango Card (RaaS API)** (poor) — 1000+ gift cards, prepaid cards and Reward Links in 225+ countries (rewards and incentives). Funding: Unverified.. <https://www.tangocard.com>
- **Kalixa** (poor) — Not a digital-goods supplier: a card-acquiring, payment-gateway and e-wallet processor (ex-Bwin, sold to Senjo Group in 2017). Funding: N/A. <https://www.crunchbase.com/organization/kalixa>

### What the owner prepares to open supplier accounts

- Registered business: a Mauritanian commercial register extract or certificate of incorporation, plus a tax ID. Ding's agreement says it may request these, and Reloadly and other KYB processes expect company documents.
- ID (passport) and proof of address for the director and each beneficial owner, for KYB and sanctions screening.
- A live website or app showing the shop, its terms of service and refund policy. Razer and other distributors expect an existing sales channel.
- A written AML/KYC policy and end-user fraud rules. Reloadly's client-managed KYB requires submitting an AML policy for review and re-certifying it every year.
- Estimated monthly volume per category (games, gift cards, airtime). It drives tiers, minimum deposits (EZ PIN) and API rate limits (DT One).
- Starting float in each supplier wallet: at least 100 USD for Reloadly; amounts for EZ PIN and LikeCard come from sales. Keep it in USDT TRC20 or USD for a bank wire. Reloadly accepts USDT/USDC on ERC20 and TRC20.
- A USD-capable business bank account or corporate crypto wallet (exchange account in the company's name) to fund wallets. The card currency must match the account currency on Reloadly.
- A business email on the shop's domain and a named technical contact for API credentials.
- A static server IP for whitelisting and a public HTTPS webhook URL for order-status callbacks (UniPin and EZ PIN use these).
- A list of exactly which products and regions Mauritanian customers need (for example, PUBG Global vs regional, Free Fire MENA server), to check each supplier's SKU region before going live.
- Contact emails to start with: Partnership@likecard.com (LikeCard), reseller@unipin.com (UniPin), plus the self-serve sign-ups at Reloadly, DingConnect and EZ PIN.
