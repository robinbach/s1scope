# Reading the dashboard

The dashboard answers one question at a time: if the app acts on this question's answer at threshold `t`,
how many wrong answers get through, how many right ones get stopped, and can the probabilities be taken at
face value?

## Picking what to look at

**Runs.** The sidebar lists every run in the logs. Runs are grouped by the first word of their name
(`nightly 2026-11-09` and `nightly 2026-11-10` form the group `nightly`); a group's checkbox selects all of
its runs, and groups with more than five runs start folded. Every number on the page counts only the selected runs.

**Questions.** Each question shows its type (`noul` for yes/no, `choice`, `score`) and two counts:
answers, and answers with a label. Questions with labels are listed first.

**Filter and pool.** The filter matches question ids as plain text (case-insensitive) or as a
`/regular expression/`. With a filter set, *Pool all matching* treats every matching question of the most
common type as one question, for example all the per-category questions of one prompt.

**Filters.** The filters narrow the answers of the question on screen by `model`, `backend`, `version`,
`question` (when pooled) or any tag, as `tag:<name>`: the same features as [Split by](#split-by). Tags belong to
single calls (see [the log format](format.md)), so filters work on answers, not on runs. Pick a feature from the
list to add it; its values appear as checkboxes, each with how many answers it has. A new filter starts with
every value ticked, which filters nothing. Ticked values of one feature are alternatives; two features narrow
each other, so `tag:variant` v0 or v1 *and* `model` jev-1.13 keeps both variants' answers from that model. Each
value's count is taken after the other filters. Answers without a tag have the value `(none)`. *×* removes a
filter. The filters stay when you pick another question (one on a tag that question's answers lack is left
aside); the question list's counts ignore them.

## The two kinds of question

What `p` means and what the threshold does depends on the question type:

| type | `p` | at or above `t` | "right" means |
| --- | --- | --- | --- |
| yes/no (`noul`) | P(yes) | the app accepts: treats the answer as yes | the label is yes |
| choice | confidence of the chosen option | the app trusts the choice | the chosen option equals the label |

Score questions are listed but only counted for now; their charts are not built yet.

## Threshold

The slider and the number box set `t` from 0 to 1. When the logs record the threshold the calling app uses
(`thresholds` in a record), the most common one is the starting value, and *app threshold* jumps back to it.
Every tile, chart and table below follows `t`.

## Tiles

The tiles need labels. Without any, the page shows the distribution only.

For a yes/no question:

| tile | counts |
| --- | --- |
| False accept | label no, `p ≥ t`: the app says yes when it should not |
| False reject | label yes, `p < t`: the app says no when it should say yes |
| Precision | of the answers with `p ≥ t`, the share whose label is yes |
| Recall | of the answers whose label is yes, the share with `p ≥ t` |

For a choice question:

| tile | counts |
| --- | --- |
| Wrong but trusted | wrong choice with confidence `≥ t` |
| Right but not trusted | right choice with confidence `< t` |
| Trusted | share of answers with confidence `≥ t` |
| Accuracy when trusted | of the trusted answers, the share that are right |

Two tiles do not depend on `t`; they say whether `p` means what it says:

- **Brier score**: the mean of `(p − y)²`, with `y` = 1 for yes (or a right choice) and 0 otherwise.
  0 is perfect; always answering 0.5 scores 0.25. Lower is better.
- **ECE** (expected calibration error): split the answers into ten bins of `p` (0–0.1, 0.1–0.2, …), take
  the gap between the mean `p` and the observed rate in each bin, and average the gaps weighted by bin size.
  An ECE of 0.05 means that, on average, the stated probability is 5 points away from how often it comes true.

## Charts

**Distribution of p.** A histogram of `p`, stacked by label: expected yes (or right) at the bottom,
expected no (or wrong) above it, unlabeled answers on top. The dashed line is `t`. A good model piles the
two colors at opposite ends; overlap around `t` is where the errors come from. *Bar height: square root*
makes small bars visible next to large ones.

**Reliability.** Predicted `p` (the mean in each of the ten bins) against the observed rate in that bin.
Points on the dashed diagonal are calibrated. Points below it mean the model is overconfident there;
points above it, underconfident. Dot size is the number of answers in the bin.

**Threshold sweep.** The two error counts at every threshold from 0 to 1 in steps of 0.01. Raising `t`
trades false accepts (falling) for false rejects (rising); the dashed line is the current `t`. Use it to see
how much one kind of error costs in the other.

## Split by

*Split by* draws each chart once per group: by run, model, backend, question, question version, or any tag
recorded with the calls (`tag:lang`, …). The eight largest groups get their own row; the rest are drawn
together as `(other)`.

## Question versions

Each answer is tied to the question exactly as it was sent: the question's definition is fingerprinted
(an 8-character hash of its JSON), so a change in wording, options or instructions makes a new version.
*Question as sent* shows each version's text, its answer count and the runs that used it. When there is
more than one version, split by `version` before trusting pooled numbers.

## The tables

Below the charts:

- **Errors at t**: labeled answers on the wrong side of the threshold, the most confident mistakes first.
- **Near threshold (±0.10)**: answers whose `p` is within 0.1 of `t`, closest first. These flip when `t` moves a little.
- **All**: every answer with a `p`.

Click a row to open the call: run, item, model as resolved by the server, backend, time, latency, status,
tags, the answer, the question as sent, the state, every answer in the call, and the raw request and
response. Escape closes it.

## Sharing a view

Everything above lives in the page address, so the address always reproduces the current view.
*Copy link* in the top bar copies it. The parameters are listed in [Links and CLI](reference.md).
