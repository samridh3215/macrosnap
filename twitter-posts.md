# Macro Snap: Twitter/X drafts (engagement format)

Drafts only, nothing posted. `{URL}` counts as 23 chars (t.co). `Media:` lines are placeholders and are not part of the tweet text.

## Posting tips

- Hook in line 1. Short lines, one idea per tweet.
- Attach a short video/GIF or screenshot to the first tweet; posts with media tend to do better.
- Keep links out of the main tweet and put them in the first reply; links often reduce reach.
- End the thread with a question so people reply. Reply to every comment in the first hour.
- Post the thread when your audience is awake, and post the standalones on separate days.

## Launch / hook tweet (post this first, link goes in a reply)

```
I thought I was in a calorie deficit for months.

I was eating at maintenance.

So I built my own calorie tracker that doesn't guess. Share a food photo, get macros that are actually calculated. 🧵
```
Media: [DEMO VIDEO/GIF, 10-15s: gallery > share > Macro Snap > macros]
Characters: 196/280

## Thread 2/8

```
The problem: "healthy" food felt low calorie, and every tracker I tried quietly rounded in my favour.

I'd log a meal, trust the number, and the scale wouldn't move.
```
Characters: 165/280

## Thread 3/8

```
And I didn't want to pay a subscription just to count calories. Felt wrong.

So I built the thing I wanted: share a photo from your gallery, done. No searching a database for "dal".
```
Characters: 181/280

## Thread 4/8

```
It uses two models, on purpose.

1. A fast vision model names what's on the plate and guesses grams
2. A stronger reasoning model works out nutrition per 100 g from a recipe breakdown

Vision never invents nutrition.
```
Media: [SCREENSHOT: review sheet with items and grams]
Characters: 216/280

## Thread 5/8

```
The part I trust most: the AI doesn't get the last word. Math does.

Every food must pass:
- kcal matches the macros (4/4/9/2)
- macros can't exceed 100 g per 100 g
- ingredient kcal adds up to the total

Fail? It re-derives. Still fail? Flagged.
```
Media: [SCREENSHOT: breakdown view]
Characters: 246/280

## Thread 6/8

```
It learns from me.

If the photo says "X" and I rename it to "Y" twice, X becomes a permanent alias of Y.

Foods are cached, so a dish I've eaten before costs zero model calls.
```
Characters: 176/280

## Thread 7/8

```
Targets adapt too.

It compares what I log with my 28-day weight trend and corrects the formula calories for my real metabolism, so my deficit is a real one.
```
Media: [SCREENSHOT: Trends / adaptive TDEE]
Characters: 157/280

## Thread 8/8

```
I'm building this in public and will share what I learn on the fat loss side too.

Follow along if that's useful.

What's the worst way a calorie tracker has misled you? 👇
```
Characters: 171/280

## Reply to tweet 1 (link lives here, not in the main tweet)

```
Repo and install steps: {URL}
```
Characters: 47/280

## Standalone A: contrarian hook

```
Hot take: most calorie trackers are confidently wrong.

Mine proposes a number with AI, then plain code checks the arithmetic before I'm allowed to trust it.

The LLM proposes. Math disposes.
```
Media: [SCREENSHOT: breakdown view]
Characters: 191/280

## Standalone B: relatable

```
Calorie apps: "search for your food, pick whichever entry looks right"

Me, holding a plate of rajma chawal: no.

Macro Snap: share the photo, argue with the grams, move on with your life.
```
Media: [GIF: share sheet to result in a few taps]
Characters: 188/280

## Standalone C: Indian food

```
Why trackers fail on Indian food:

"dal" means a hundred different things at a hundred different tables.

Mine builds nutrition from the recipe, treats daal = dal and chapati = roti, and lets me set 1 roti = 40 g.
```
Media: [SCREENSHOT: Indian meal result]
Characters: 213/280

## Standalone D: question for replies

```
Fat loss question:

Do you actually know you're in a deficit, or do you just think you are?

I didn't. That's why I built a tracker that checks my intake against my real weight trend.
```
Characters: 183/280

## Standalone E: privacy / cost

```
I refused to pay for a calorie app, so Macro Snap runs on my own OpenRouter key.

The key stays on my phone, and it shows me the model cost of every analysis.

No subscription.
```
Media: [SCREENSHOT: Settings + cost per analysis]
Characters: 176/280
