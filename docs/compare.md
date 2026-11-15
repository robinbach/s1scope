# Comparing runs

Compare lines up two slices of the same question sample by sample: two runs, two models, two question
versions, or two values of any tag. It answers what changed between A and B, and on which samples.

Open it with the *Compare* tab above the threshold. Everything in [Picking what to look at](dashboard.md#picking-what-to-look-at)
still applies: the slices come from the selected runs and the selected (or pooled) question.

## Choosing A and B

| control | what it does |
| --- | --- |
| Compare by | the feature that splits the rows: `run`, `model`, `backend`, `version`, `tag:<name>`, and `question` when pooled |
| A, B | the two values to compare; ⇄ swaps them |

By default the page picks the newest value (by name, so the latest timestamped run) that shares samples with
another, and compares it, as B, with the value it shares the most samples with, as A.

## How samples line up

A sample is one item and one question. A row needs an `item` to be lined up; rows without one are counted
and left out. When a sample was asked several times on one side (repeats in a run, or several runs pooled
under one model), its `p` is averaged and its accuracy is the share of repeats decided correctly. The table
shows the repeat count as `×3`.

Each sample is then:

| change | meaning |
| --- | --- |
| worse | B decides it correctly less often than A, at the current threshold |
| better | B decides it correctly more often than A |
| same | equally often |
| unlabeled | no label, so right and wrong are unknown; it still counts for Δp |

Right or wrong is judged at the threshold set above, the same way as on the overview: `p ≥ t` must agree with
the label.

## Tiles

| tile | counts |
| --- | --- |
| Worse in B | samples right in A and wrong in B |
| Better in B | samples wrong in A and right in B |
| Errors A → B | errors on each side, over the labeled samples both have |
| Mean \|Δp\| | how far `p` moved on average, labeled or not |

A line above the tiles says how many samples both sides share, and how many are only in A or only in B.

## The scatter

One dot per sample: `p` in A across, `p` in B up. On the dashed diagonal nothing changed. For a yes/no
question, dots above it are samples where B says yes more strongly; for a choice question, where B is more
sure of its choice. The dashed lines at `t` divide the plot into the four accept/reject combinations. Worse
and better samples are drawn solid; the rest faded. Click a dot to open its B record.

## The table

| tab | rows |
| --- | --- |
| Worse | worse samples, biggest change in `p` first |
| Better | better samples, biggest change first |
| Biggest Δp | every sample, by how far `p` moved |
| All | every sample |

Click a row to open the B record; click the A or B `p` to open that side's record.

## Example

The demo data has two models answering the same 400 tickets. To see where the larger model is worse:

1. Select both demo runs and the `urgent` question.
2. Open *Compare*, compare by `model`, A = `demo-small-1.0`, B = `demo-large-2.1`.
3. Look at *Worse*. Then select only the large model's run, go back to the overview and split by `tag:lang`:
   the reliability curve for `de` sits further from the diagonal than the one for `en`.

The same view as a link: `#q=urgent&view=compare&by=model&a=demo-small-1.0&b=demo-large-2.1&tab=worse`
(see [Links and CLI](reference.md#link-parameters)).
