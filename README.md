# The Same Machine

**Are real memories and made-up stories built the same way?** An interactive look at 6,854 stories.

Live: https://aliqureshi1206.github.io/the-same-machine/

Research from the Schacter Memory Lab at Harvard suggests that remembering the past and imagining the future use the same brain machinery: each memory is rebuilt from pieces, not replayed like a video. This project tests that idea on the Hippocorpus, a public collection of stories in which:

- people wrote about something real that happened to them,
- strangers wrote made-up versions of the same events, and
- the original writers told their memory again months later.

Every story is measured 25 ways, using simple counts (numbers, dates, "thinking" words) and published lists of about 90,000 words that people rated for things like how concrete they are and which senses they bring to mind.

## What it found

- **Real memories have more details.** They are about 14% longer and use 60% more numbers, plus more dates, specific words and things you can see.
- **Made-up stories have more thinking.** They use about 30% more words like *think*, *know* and *maybe*, and more general statements.
- **But mostly they look the same.** All the differences are small, and a computer model is right only 64% of the time (a coin flip is 50%).
- **Memories change when retold.** The memories people think about most, and care about most, change the most between tellings. Memories first told with lots of sensory detail change the least.
- **Age affects both in the same way.** Between ages 18 and 55+, memory and imagination mostly shift together, which fits the "same machine" idea.

## Reproduce

```bash
python analysis/build.py --data /path/to/raw --out data.json
```

Expected inputs:
- `hc/hcV3-stories.csv`, `hc/hcV3-eventAnnotsAggOverWorkers.csv`: [Hippocorpus v3](https://www.microsoft.com/en-us/download/details.aspx?id=105291) (Sap et al., 2020)
- `norms/conc.txt`: Brysbaert, Warriner & Kuperman (2014) concreteness norms
- `norms/lancaster.csv`: Lynott et al. (2020) Lancaster Sensorimotor Norms ([OSF](https://osf.io/48wsc/))
- `norms/warriner.csv`: Warriner, Kuperman & Brysbaert (2013) affective norms

Requires Python 3 with pandas, numpy, scipy and scikit-learn. Runs in about 40 seconds. Raw data is not redistributed here.

The site is static (`index.html`, `style.css`, `app.js`, `data.json`) and uses D3 v7.

---

An independent, exploratory project by Ali Qureshi, inspired by the research of the [Schacter Memory Lab](https://sites.harvard.edu/schacter-memory/home/research/) at Harvard. Not affiliated with or endorsed by the lab.
