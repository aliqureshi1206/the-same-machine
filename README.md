# The Same Machine

**What 6,854 remembered, imagined and retold stories reveal about constructive memory.**

Live: https://aliqureshi1206.github.io/the-same-machine/

An interactive data story built around the *constructive episodic simulation hypothesis* (Schacter & Addis, 2007): the idea that remembering the past and imagining the future are carried out by the same constructive system. It uses the Hippocorpus, which pairs real memories with imagined versions of the same events and with retellings of the same memory months later, and scores every story against ~90,000 human-rated words.

## Findings

- **Signature.** Real memories carry more specific anchors (numerals, dates, rarer words, concrete and visual language). Imagined stories carry more thinking words, hedges, generalities and interoceptive (bodily) language. This matches the predictions of reality-monitoring theory. All effects are small (|d| ≤ 0.42).
- **Shared territory.** In semantic space, remembered and imagined stories are fully intermixed.
- **Distortion.** Across 1,310 memory/retelling pairs, the memories people rehearse most, and rate as most important, change the most between tellings. Sensory-rich memories change the least (ρ ≈ −.23).
- **Age.** Between ages 18 and 55+, age-related changes in sensory language, thinking words and generalities run in parallel for remembering and imagining.
- **Separability.** A cross-validated model separates memory from imagination at AUC 0.69 using 25 interpretable measures, and at 0.78 using the full vocabulary. Retellings score between the two.

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
