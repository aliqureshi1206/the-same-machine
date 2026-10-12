"""
The Same Machine: analysis pipeline.

Reads Hippocorpus (Sap et al., 2020) and three lexical norm sets, computes
per-story features, and writes the aggregated JSON the site renders.

Usage:
    python analysis/build.py --data /path/to/raw --out data.json

Expected files in --data:
    hc/hcV3-stories.csv, hc/hcV3-eventAnnotsAggOverWorkers.csv
    norms/conc.txt        Brysbaert, Warriner & Kuperman (2014) concreteness
    norms/lancaster.csv   Lynott et al. (2020) Lancaster Sensorimotor Norms
    norms/warriner.csv    Warriner, Kuperman & Brysbaert (2013) affect norms
"""
import argparse
import json
import re
from collections import Counter

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.manifold import TSNE
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

RNG = np.random.default_rng(7)

ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()
D = args.data.rstrip("/")

# ---------------------------------------------------------------- load
st = pd.read_csv(f"{D}/hc/hcV3-stories.csv")
st = st[st.story.notna()].reset_index(drop=True)
ev = pd.read_csv(f"{D}/hc/hcV3-eventAnnotsAggOverWorkers.csv")

conc = pd.read_csv(f"{D}/norms/conc.txt", sep="\t")
conc = conc[conc.Bigram == 0]
CONC = dict(zip(conc.Word.str.lower(), conc["Conc.M"]))
FREQ = dict(zip(conc.Word.str.lower(), np.log10(conc.SUBTLEX.clip(lower=0) + 1)))

lan = pd.read_csv(f"{D}/norms/lancaster.csv")
lan["Word"] = lan.Word.str.lower()
MODS = ["Visual", "Auditory", "Haptic", "Gustatory", "Olfactory", "Interoceptive"]
LAN = {m: dict(zip(lan.Word, lan[f"{m}.mean"])) for m in MODS}
LAN["perc"] = dict(zip(lan.Word, lan["Max_strength.perceptual"]))

war = pd.read_csv(f"{D}/norms/warriner.csv")
VAL = dict(zip(war.Word.str.lower(), war["V.Mean.Sum"]))
ARO = dict(zip(war.Word.str.lower(), war["A.Mean.Sum"]))

STOP = set("""a an the and or but if so of to in on at by for with from as is was were be been
being am are it its this that these those i me my mine we us our you your he him his she her
they them their there then than not no do did does done have has had will would can could
just very really also too up out about into over after before when while what which who whom
how all any some because got get go went one""".split())

# small closed-class lexicons (hand-built; transparent on purpose)
COG = set("""think thought thinking know knew known realize realized realise realised understand
understood remember remembered recall recalled believe believed wonder wondered guess guessed
decide decided consider considered figure figured imagine imagined suppose supposed reason
learned learnt notice noticed""".split())
TENTATIVE = set("""maybe perhaps probably possibly might seem seemed seems somehow somewhat
guess unsure kind sort almost apparently""".split())
TIME = set("""morning afternoon evening night midnight noon today yesterday tomorrow tonight
monday tuesday wednesday thursday friday saturday sunday january february march april may june
july august september october november december week weekend month year minutes minute hour
hours seconds o'clock oclock pm am spring summer fall autumn winter""".split())
SPACE = set("""inside outside behind beside between across under above below near nearby
upstairs downstairs left right corner door room kitchen street road car house hospital
office table window floor""".split())
FAMILY = set("""mom mother dad father son daughter husband wife brother sister grandma grandmother
grandpa grandfather aunt uncle cousin baby kids children child family boyfriend girlfriend
fiance fiancee""".split())
GENERIC = set("""always usually often never everyone everybody people anyone anything everything
things thing life world generally typically""".split())

TOK = re.compile(r"[A-Za-z']+|\d+")
SENT = re.compile(r"(?<=[.!?])\s+")


def mattr(toks, w=50):
    if len(toks) < w:
        return len(set(toks)) / max(len(toks), 1)
    c = Counter(toks[:w])
    s = len(c) / w
    tot, n = s, 1
    for i in range(w, len(toks)):
        c[toks[i]] += 1
        o = toks[i - w]
        c[o] -= 1
        if c[o] == 0:
            del c[o]
        tot += len(c) / w
        n += 1
    return tot / n


def mean_lookup(toks, table):
    v = [table[t] for t in toks if t in table]
    return float(np.mean(v)) if v else np.nan


def featurize(text):
    raw = TOK.findall(text)
    toks = [t.lower() for t in raw]
    n = len(toks)
    content = [t for t in toks if t not in STOP and not t.isdigit()]
    sents = [s for s in SENT.split(text.strip()) if s]
    # proper nouns: capitalised, not sentence-initial, not "I"
    prop = 0
    for s in sents:
        w = TOK.findall(s)
        prop += sum(1 for x in w[1:] if x[0].isupper() and x not in ("I", "I'm", "I've", "I'd", "I'll"))
    f = {
        "words": n,
        "sentences": len(sents),
        "sentLen": n / max(len(sents), 1),
        "diversity": mattr(toks),
        "concreteness": mean_lookup(content, CONC),
        "rarity": -mean_lookup(content, FREQ),
        "perceptual": mean_lookup(content, LAN["perc"]),
        "valence": mean_lookup(content, VAL),
        "arousal": mean_lookup(content, ARO),
        "i": 100 * sum(t in ("i", "me", "my", "mine", "myself") for t in toks) / n,
        "we": 100 * sum(t in ("we", "us", "our", "ours") for t in toks) / n,
        "cognitive": 100 * sum(t in COG for t in toks) / n,
        "tentative": 100 * sum(t in TENTATIVE for t in toks) / n,
        "time": 100 * sum(t in TIME for t in toks) / n,
        "space": 100 * sum(t in SPACE for t in toks) / n,
        "numbers": 100 * sum(t.isdigit() for t in raw) / n,
        "properNouns": 100 * prop / n,
        "family": 100 * sum(t in FAMILY for t in toks) / n,
        "generic": 100 * sum(t in GENERIC for t in toks) / n,
    }
    for m in MODS:
        f[m] = mean_lookup(content, LAN[m])
    return f


print("featurising", len(st))
F = pd.DataFrame([featurize(s) for s in st.story])

# sentence-to-sentence lexical continuity (a cheap stand-in for narrative flow)
tf_sent = TfidfVectorizer(stop_words="english", min_df=2).fit(st.story)


def continuity(text):
    ss = [s for s in SENT.split(text.strip()) if len(s) > 3]
    if len(ss) < 3:
        return np.nan
    X = tf_sent.transform(ss)
    sims = (X[:-1].multiply(X[1:])).sum(axis=1).A1
    return float(np.mean(sims))


F["continuity"] = [continuity(s) for s in st.story]
df = pd.concat([st, F], axis=1)

FEATS = {
    "perceptual": ("Sensory strength", "Mean perceptual strength of content words (Lancaster norms, 0–5)"),
    "concreteness": ("Concreteness", "Mean concreteness of content words (Brysbaert norms, 1–5)"),
    "Visual": ("Visual", "Visual strength"),
    "Auditory": ("Auditory", "Auditory strength"),
    "Haptic": ("Touch", "Haptic strength"),
    "Gustatory": ("Taste", "Gustatory strength"),
    "Olfactory": ("Smell", "Olfactory strength"),
    "Interoceptive": ("Body", "Interoceptive strength"),
    "time": ("Time anchors", "Clock/calendar words per 100 words"),
    "space": ("Place anchors", "Spatial/location words per 100 words"),
    "numbers": ("Numerals", "Digits per 100 words"),
    "properNouns": ("Proper nouns", "Mid-sentence capitalised words per 100"),
    "rarity": ("Word rarity", "Negative mean log10 SUBTLEX frequency"),
    "diversity": ("Lexical diversity", "Moving-average type/token ratio (w=50)"),
    "cognitive": ("Thinking words", "Cognitive-process words per 100 words"),
    "tentative": ("Hedges", "Tentative words per 100 words"),
    "generic": ("Generalities", "Generic/semantic words per 100 words"),
    "i": ("I / me / my", "First-person singular per 100 words"),
    "we": ("We / us", "First-person plural per 100 words"),
    "family": ("Family words", "Kin terms per 100 words"),
    "valence": ("Valence", "Mean pleasantness (Warriner, 1–9)"),
    "arousal": ("Arousal", "Mean arousal (Warriner, 1–9)"),
    "continuity": ("Continuity", "Mean TF-IDF cosine between adjacent sentences"),
    "words": ("Length", "Words per story"),
    "sentLen": ("Sentence length", "Words per sentence"),
}
FKEYS = list(FEATS)

rec = df[df.memType == "recalled"]
img = df[df.memType == "imagined"]
ret = df[df.memType == "retold"]


def boot_ci(x, n=2000):
    x = np.asarray(x)
    x = x[~np.isnan(x)]
    idx = RNG.integers(0, len(x), (n, len(x)))
    m = x[idx].mean(1)
    return float(x.mean()), float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))


def cohen_d(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    a, b = a[~np.isnan(a)], b[~np.isnan(b)]
    sp = np.sqrt(((len(a) - 1) * a.var(ddof=1) + (len(b) - 1) * b.var(ddof=1)) / (len(a) + len(b) - 2))
    d = (a.mean() - b.mean()) / sp
    se = np.sqrt((len(a) + len(b)) / (len(a) * len(b)) + d ** 2 / (2 * (len(a) + len(b))))
    return float(d), float(d - 1.96 * se), float(d + 1.96 * se)


out = {"meta": {}, "features": {k: {"label": v[0], "desc": v[1]} for k, v in FEATS.items()}}
out["meta"] = {
    "n": int(len(df)),
    "counts": df.memType.value_counts().to_dict(),
    "workers": int(df.WorkerId.nunique()),
    "words": int(df.words.sum()),
    "sentences": int(df.sentences.sum()),
    "normWords": {"concreteness": len(CONC), "lancaster": len(lan), "warriner": len(VAL)},
}

# ------------------------------------------------ 1. group effects
effects = []
for k in FKEYS:
    d, lo, hi = cohen_d(rec[k], img[k])
    t, p = stats.ttest_ind(rec[k].dropna(), img[k].dropna(), equal_var=False)
    effects.append({"key": k, "d": d, "lo": lo, "hi": hi, "p": float(p),
                    "means": {g: boot_ci(df[df.memType == g][k]) for g in ("recalled", "imagined", "retold")}})
effects.sort(key=lambda e: e["d"])
out["effects"] = effects

# distributions for the ridgeline/histograms
dist = {}
for k in ["perceptual", "concreteness", "time", "properNouns", "cognitive", "generic", "i", "words"]:
    lo, hi = np.nanpercentile(df[k], [1, 99])
    bins = np.linspace(lo, hi, 41)
    dist[k] = {"bins": bins.round(4).tolist(),
               **{g: np.histogram(df[df.memType == g][k].dropna().clip(lo, hi), bins=bins, density=True)[0].round(5).tolist()
                  for g in ("recalled", "imagined", "retold")}}
out["dist"] = dist

# sensory fingerprint (z relative to all stories)
fp = {}
for g in ("recalled", "imagined", "retold"):
    sub = df[df.memType == g]
    fp[g] = {m: float((sub[m].mean() - df[m].mean()) / df[m].std()) for m in MODS}
out["fingerprint"] = fp

# ------------------------------------------------ 2. paired design (imagined seeded from a recalled summary)
pairs = img.merge(rec, left_on="recImgPairId", right_on="AssignmentId", suffixes=("_img", "_rec"))
paired = {}
for k in FKEYS:
    diff = (pairs[f"{k}_rec"] - pairs[f"{k}_img"]).dropna()
    paired[k] = {"n": int(len(diff)), "meanDiff": float(diff.mean()),
                 "pctRecHigher": float((diff > 0).mean()),
                 "dz": float(diff.mean() / diff.std()),
                 "p": float(stats.wilcoxon(diff).pvalue)}
out["paired"] = paired
pp = pairs[["perceptual_rec", "perceptual_img"]].dropna()
sel = pp.sample(min(1200, len(pp)), random_state=1)
out["pairScatter"] = sel.round(4).values.tolist()

# ------------------------------------------------ 3. classifier: how separable are memory and imagination?
ri = df[df.memType.isin(["recalled", "imagined"])].copy()
y = (ri.memType == "recalled").astype(int).values
X = ri[FKEYS].fillna(ri[FKEYS].median()).values
groups = ri.WorkerId.values
gkf = GroupKFold(n_splits=5)
oof = np.zeros(len(ri))
for tr, te in gkf.split(X, y, groups):
    m = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0))
    m.fit(X[tr], y[tr])
    oof[te] = m.predict_proba(X[te])[:, 1]
auc_feat = roc_auc_score(y, oof)

tfidf = TfidfVectorizer(stop_words="english", min_df=3, max_df=0.6, ngram_range=(1, 2), sublinear_tf=True)
oof_t = np.zeros(len(ri))
for tr, te in gkf.split(X, y, groups):
    vec = tfidf.fit(ri.story.values[tr])
    m = LogisticRegression(max_iter=3000, C=2.0)
    m.fit(vec.transform(ri.story.values[tr]), y[tr])
    oof_t[te] = m.predict_proba(vec.transform(ri.story.values[te]))[:, 1]
auc_text = roc_auc_score(y, oof_t)

final = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0)).fit(X, y)
coefs = final[-1].coef_[0]
out["classifier"] = {
    "aucFeatures": float(auc_feat), "aucText": float(auc_text),
    "coefs": sorted([{"key": k, "w": float(w)} for k, w in zip(FKEYS, coefs)], key=lambda c: c["w"]),
}
ri["pRec"] = oof
# all stories scored by the final interpretable model (retold never seen in training)
df["pRec"] = final.predict_proba(df[FKEYS].fillna(ri[FKEYS].median()).values)[:, 1]
df.loc[ri.index, "pRec"] = oof  # out-of-fold for training rows
rec, img, ret = (df[df.memType == g] for g in ("recalled", "imagined", "retold"))
out["pRecHist"] = {g: np.histogram(df[df.memType == g].pRec, bins=np.linspace(0, 1, 26), density=True)[0].round(4).tolist()
                   for g in ("recalled", "imagined", "retold")}

# ------------------------------------------------ 4. retelling: same person, same event, ~months later
rp = ret.merge(rec, left_on="recAgnPairId", right_on="AssignmentId", suffixes=("_ret", "_rec"))
vec_all = TfidfVectorizer(stop_words="english", min_df=2, sublinear_tf=True).fit(df.story)
A = vec_all.transform(rp.story_rec)
B = vec_all.transform(rp.story_ret)
rp["sim"] = np.asarray(A.multiply(B).sum(1)).ravel()

# baseline: how similar is an imagined story to the recalled story it was seeded from
A2 = vec_all.transform(pairs.story_rec)
B2 = vec_all.transform(pairs.story_img)
pairs["sim"] = np.asarray(A2.multiply(B2).sum(1)).ravel()
# and a random pair baseline
perm = RNG.permutation(len(rp))
rp_rand = np.asarray(A.multiply(B[perm]).sum(1)).ravel()

bins = np.linspace(0, 1, 41)
out["retell"] = {
    "n": int(len(rp)),
    "simHist": {
        "retold": np.histogram(rp.sim, bins=bins, density=True)[0].round(4).tolist(),
        "imagined": np.histogram(pairs.sim, bins=bins, density=True)[0].round(4).tolist(),
        "random": np.histogram(rp_rand, bins=bins, density=True)[0].round(4).tolist(),
        "bins": bins.round(3).tolist(),
    },
    "simMedian": {"retold": float(rp.sim.median()), "imagined": float(pairs.sim.median()), "random": float(np.median(rp_rand))},
    "deltas": [],
    "pRecShift": {
        "original": boot_ci(rp.pRec_rec), "retold": boot_ci(rp.pRec_ret),
        "pctMoreImagined": float((rp.pRec_ret < rp.pRec_rec).mean()),
    },
}
for k in FKEYS:
    dd = (rp[f"{k}_ret"] - rp[f"{k}_rec"]).dropna()
    out["retell"]["deltas"].append({"key": k, "dz": float(dd.mean() / dd.std()), "p": float(stats.wilcoxon(dd).pvalue),
                                     "pctUp": float((dd > 0).mean())})
out["retell"]["deltas"].sort(key=lambda e: e["dz"])

# what predicts how much a memory changes? (rehearsal, importance, etc.)
rp["drift"] = 1 - rp.sim
rp["lenRatio"] = np.log2(rp.words_ret / rp.words_rec)
pred = {}
for v, lab in [("importance_rec", "Importance"), ("frequency_rec", "Rehearsal (how often recalled)"),
               ("draining_rec", "Emotionally draining"), ("stressful_rec", "Stressful to write"),
               ("openness_rec", "Openness"), ("annotatorAge_rec", "Age"),
               ("logTimeSinceEvent_rec", "Time since event (log)"), ("words_rec", "Original length"),
               ("perceptual_rec", "Original sensory strength")]:
    s = rp[[v, "drift"]].dropna()
    r, p = stats.spearmanr(s[v], s.drift)
    pred[v] = {"label": lab, "r": float(r), "p": float(p), "n": int(len(s))}
out["retell"]["driftPredictors"] = pred
s = rp[["frequency_rec", "drift"]].dropna()
out["retell"]["driftByFreq"] = {int(k): boot_ci(g.drift) for k, g in s.groupby("frequency_rec") if len(g) > 20}
s = rp[["importance_rec", "drift"]].dropna()
out["retell"]["driftByImportance"] = {int(k): boot_ci(g.drift) for k, g in s.groupby("importance_rec") if len(g) > 20}

# ------------------------------------------------ 5. age: does detail decline in parallel for past and future?
AGE = [18, 25, 30, 35, 40, 45, 50, 55]
age = {}
for k in ["perceptual", "concreteness", "time", "properNouns", "cognitive", "generic", "words", "diversity", "pRec"]:
    age[k] = {}
    for g in ("recalled", "imagined"):
        sub = df[df.memType == g]
        age[k][g] = [dict(zip(["m", "lo", "hi"], boot_ci(sub[sub.annotatorAge == a][k]))) | {"n": int((sub.annotatorAge == a).sum())}
                     for a in AGE]
    # interaction test: age slope differs between recalled and imagined?
    sub = df[df.memType.isin(["recalled", "imagined"]) & df.annotatorAge.notna()][[k, "annotatorAge", "memType"]].dropna()
    z = (sub[k] - sub[k].mean()) / sub[k].std()
    a = (sub.annotatorAge - sub.annotatorAge.mean()) / 10
    r = (sub.memType == "recalled").astype(float)
    Xd = np.column_stack([np.ones(len(sub)), a, r, a * r])
    beta, *_ = np.linalg.lstsq(Xd, z.values, rcond=None)
    resid = z.values - Xd @ beta
    sigma2 = resid @ resid / (len(z) - 4)
    se = np.sqrt(np.diag(sigma2 * np.linalg.inv(Xd.T @ Xd)))
    age[k]["model"] = {"ageSlope": float(beta[1]), "ageSlopeP": float(2 * stats.t.sf(abs(beta[1] / se[1]), len(z) - 4)),
                       "interaction": float(beta[3]), "interactionP": float(2 * stats.t.sf(abs(beta[3] / se[3]), len(z) - 4))}
out["age"] = {"buckets": AGE, "series": age}

# ------------------------------------------------ 6. time since event (recalled only)
tse = rec[(rec.timeSinceEvent >= 0) & (rec.timeSinceEvent < 365 * 60)].copy()
TB = [(0, 7, "< 1 wk"), (7, 30, "1–4 wk"), (30, 91, "1–3 mo"), (91, 182, "3–6 mo"),
      (182, 365, "6–12 mo"), (365, 730, "1–2 yr"), (730, 1825, "2–5 yr"), (1825, 1e9, "5 yr +")]
tbo = {"labels": [b[2] for b in TB], "n": [], "series": {}}
for lo_, hi_, _ in TB:
    tbo["n"].append(int(((tse.timeSinceEvent >= lo_) & (tse.timeSinceEvent < hi_)).sum()))
for k in ["perceptual", "concreteness", "time", "properNouns", "numbers", "cognitive", "generic", "pRec", "importance", "frequency"]:
    tbo["series"][k] = [dict(zip(["m", "lo", "hi"], boot_ci(tse[(tse.timeSinceEvent >= lo_) & (tse.timeSinceEvent < hi_)][k])))
                        for lo_, hi_, _ in TB]
    r, p = stats.spearmanr(np.log1p(tse.timeSinceEvent), tse[k], nan_policy="omit")
    tbo["series"][k + "_r"] = {"r": float(r), "p": float(p)}
out["timeSince"] = tbo

# ------------------------------------------------ 7. correlation matrix: language x self-report
SELF = [("importance", "Importance"), ("frequency", "Rehearsal"), ("similarity", "Similar to own life"),
        ("draining", "Draining"), ("stressful", "Stressful"), ("distracted", "Distracted"),
        ("openness", "Openness"), ("annotatorAge", "Age"), ("logTimeSinceEvent", "Time since (log)"),
        ("WorkTimeInSeconds", "Time on task")]
CM = ["perceptual", "concreteness", "Visual", "Auditory", "Haptic", "Gustatory", "Olfactory", "Interoceptive",
      "time", "space", "numbers", "properNouns", "rarity", "diversity", "cognitive", "tentative", "generic",
      "i", "we", "family", "valence", "arousal", "continuity", "words"]
corr = {}
for g in ("recalled", "imagined", "retold"):
    sub = df[df.memType == g]
    rows = []
    for k in CM:
        row = []
        for s_, _ in SELF:
            d_ = sub[[k, s_]].dropna()
            if len(d_) < 50 or d_[s_].nunique() < 2:
                row.append(None)
                continue
            r, p = stats.spearmanr(d_[k], d_[s_])
            row.append([round(float(r), 3), float(p), int(len(d_))])
        rows.append(row)
    corr[g] = rows
out["corr"] = {"rows": CM, "cols": [l for _, l in SELF], "colKeys": [s for s, _ in SELF], "data": corr}

# feature x feature (all stories)
ff = df[CM].corr(method="spearman").round(3)
out["featCorr"] = {"keys": CM, "m": ff.values.tolist()}

# ------------------------------------------------ 8. openness (creativity proxy) and imagination
op = {}
for g in ("recalled", "imagined"):
    sub = df[df.memType == g].copy()
    sub["oq"] = pd.qcut(sub.openness.rank(method="first"), 5, labels=False)
    op[g] = {k: [boot_ci(sub[sub.oq == q][k])[0] for q in range(5)] for k in ["perceptual", "diversity", "rarity", "words", "generic", "cognitive"]}
    op[g]["r"] = {k: float(stats.spearmanr(sub.openness, sub[k], nan_policy="omit")[0]) for k in ["perceptual", "diversity", "rarity", "words", "generic", "cognitive"]}
out["openness"] = op

# ------------------------------------------------ 9. distinctive words (Monroe et al. 2008 log-odds, informative Dirichlet prior)
def counts(texts):
    c = Counter()
    for t in texts:
        c.update(w.lower() for w in TOK.findall(t) if not w.isdigit())
    return c


cR, cI, cB = counts(rec.story), counts(img.story), counts(df.story)
nR, nI, a0 = sum(cR.values()), sum(cI.values()), sum(cB.values())
words = []
for w, fb in cB.items():
    if fb < 40:
        continue
    yR, yI = cR[w], cI[w]
    aw = fb * 0.01  # scaled prior
    a0s = a0 * 0.01
    l1 = np.log((yR + aw) / (nR + a0s - yR - aw))
    l2 = np.log((yI + aw) / (nI + a0s - yI - aw))
    var = 1 / (yR + aw) + 1 / (yI + aw)
    words.append({"w": w, "z": float((l1 - l2) / np.sqrt(var)), "f": int(fb)})
words.sort(key=lambda x: x["z"])
out["words"] = {"imagined": words[:45], "recalled": words[-45:][::-1],
                "cloud": [x for x in words if abs(x["z"]) > 2.5][:: max(1, len([x for x in words if abs(x["z"]) > 2.5]) // 900)]}

# ------------------------------------------------ 10. semantic map + topics
print("semantic map")
vec = TfidfVectorizer(stop_words="english", min_df=5, max_df=0.4, sublinear_tf=True)
Xt = vec.fit_transform(df.story)
svd = TruncatedSVD(80, random_state=0)
Z = svd.fit_transform(Xt)
Zn = Z / np.linalg.norm(Z, axis=1, keepdims=True)
K = 16
km = KMeans(K, n_init=10, random_state=0).fit(Zn)
df["topic"] = km.labels_
terms = np.array(vec.get_feature_names_out())
topics = []
for t in range(K):
    mask = df.topic == t
    cen = np.asarray(Xt[mask.values].mean(0)).ravel() - np.asarray(Xt.mean(0)).ravel()
    top = terms[np.argsort(-cen)[:8]].tolist()
    sub = df[mask]
    r_, i_ = sub[sub.memType == "recalled"], sub[sub.memType == "imagined"]
    gaps = {k: cohen_d(r_[k], i_[k])[0] for k in ["perceptual", "concreteness", "properNouns", "time", "cognitive", "generic"]} if len(r_) > 30 and len(i_) > 30 else {}
    topics.append({"id": t, "terms": top, "n": int(mask.sum()),
                   "mix": sub.memType.value_counts().to_dict(),
                   "gap": gaps, "importance": float(sub.importance.mean()),
                   "valence": float(sub.valence.mean())})
out["topics"] = topics

tsne = TSNE(2, perplexity=40, init="pca", random_state=0, learning_rate="auto")
Y = tsne.fit_transform(Z)
Y = (Y - Y.min(0)) / (Y.max(0) - Y.min(0))
code = {"recalled": 0, "imagined": 1, "retold": 2}
out["map"] = [[round(float(a), 4), round(float(b), 4), code[m], int(t), round(float(p), 3), (me or "")[:70]]
              for (a, b), m, t, p, me in zip(Y, df.memType, df.topic, df.pRec, df.mainEvent.fillna(""))]

# ------------------------------------------------ 11. event annotations (240 stories, sentence-level)
evs = ev.groupby("memType")[["eventOrNot", "majorBin", "minorBin", "expectedBin", "surprisingBin"]].mean()
out["events"] = evs.round(4).to_dict(orient="index")
# position of major events through the narrative
ev["pos"] = ev.groupby("HippocorpusAssignmentId").sentIx.transform(lambda s: s / max(s.max(), 1))
ev["pb"] = (ev.pos * 9.999).astype(int)
out["eventArc"] = {g: ev[ev.memType == g].groupby("pb")[["eventOrNot", "majorBin", "minorBin", "expectedBin", "surprisingBin"]].mean().round(4).to_dict(orient="list")
                   for g in ("recalled", "imagined", "retold")}

# ------------------------------------------------ 12. the guessing game
def excerpt(t, n=95):
    w = t.split()
    return " ".join(w[:n]) + ("…" if len(w) > n else "")


game = []
ri2 = df.loc[ri.index]
ri2 = ri2[(ri2.words > 140) & (ri2.words < 420)]
for g in ("recalled", "imagined"):
    s_ = ri2[ri2.memType == g].sample(30, random_state=11)
    for _, r in s_.iterrows():
        game.append({"t": excerpt(r.story), "g": g, "p": round(float(r.pRec), 3),
                     "e": (r.mainEvent or "")[:80],
                     "f": {k: round(float(r[k]), 3) for k in ["perceptual", "concreteness", "properNouns", "time", "cognitive", "generic"]}})
RNG.shuffle(game)
out["game"] = game
out["featPct"] = {k: np.nanpercentile(df[k], [5, 25, 50, 75, 95]).round(4).tolist() for k in FKEYS}

def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else round(float(o), 5)
    if isinstance(o, np.integer):
        return int(o)
    return o


with open(args.out, "w") as fh:
    json.dump(clean(out), fh, separators=(",", ":"), allow_nan=False)
print("wrote", args.out)
print("AUC features", auc_feat, "AUC text", auc_text)
print("retell sim median", out["retell"]["simMedian"])
for e in effects:
    print(f'{e["key"]:14s} d={e["d"]:+.3f}')
