# Photo store rules

- Media: packed/roots stay fixtures; memory 13 keeps promises; tokens/free-only, paired revisions/buddies remain. Separate configured, physical and 80% payload caps; upgrades keep sizes. Sparse tests need actor upgrade/accounting checks; live needs approval. Why: capacity is not guaranteed space.
- Photo store capacity: app ceiling (uploadPolicy) < build `--max-stable-pages` (media mops.toml, 240 GiB) < Motoko 1.16.1 shared Region table (256 GiB). Never set the page cap at/above 256 GiB without a reviewed runtime. Why: the runtime has no aggregate block-table exhaustion guard.
