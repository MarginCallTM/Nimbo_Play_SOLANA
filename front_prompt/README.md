# front_prompt — variantes de hero pour Nimbo Play

Trois prompts dérivés de la référence « casino » (fond noir grainé, flammes
saumon, nuages indigo). **Le style, la palette et la composition sont
identiques dans les trois** — seul le sujet central change.

| Fichier | Sujet à la place de la roulette | Pour quelle page |
|---|---|---|
| [01-extraction-ring.md](01-extraction-ring.md) | Anneau d'or + serpent en canalisation | `arena.nimboplay.dev` — vend la tension du jeu |
| [02-neon-serpent.md](02-neon-serpent.md) | Serpent géant jaillissant des nuages | Partout — la plus polyvalente, donne une mascotte |
| [03-arcade-cabinet.md](03-arcade-cabinet.md) | Borne d'arcade, arène affichée à l'écran | `nimboplay.dev` — vend l'ombrelle multi-jeux |

## Ce qui a été modifié par rapport à ton prompt d'origine

1. Le bloc `Elements [ ... ]` — c'est là que vivait la roulette.
2. Une phrase de garde ajoutée en fin de description de style :
   `NO casino imagery whatsoever: no roulette wheel, no chips, no dice, no
   playing cards, no gems.` Sans elle, le reste du prompt (flammes, ambiance,
   objets flottants) ramène les jetons tout seul.

Tout le reste — fond `#08080c`, flammes `#ff7878` / `#ff9e78`, nuages `#4342d6`
/ `#673ab7`, densité de détail, 55 % de vide en haut, 16:9 — est intact.

## Note sur la palette

Les couleurs de la référence sont conservées telles quelles, comme demandé.
Deux remarques pour plus tard, pas maintenant :

- L'indigo `#4342d6` des nuages est **très proche du bleu de marque** `#2249c8`
  et du serpent joueur `#3981f6`. Le rapprochement est déjà presque gratuit.
- Le halo saumon dit « danger / chaleur ». Dans le jeu, la couleur de la valeur
  est l'**or** `#ffcc66`. Une déclinaison à halo doré dirait « c'est ça que tu
  viens chercher » plutôt que « ça brûle ». La bascule est notée en fin du
  fichier 01.

## Rappel de contrainte

Le produit tourne sur **Solana devnet** (pas de valeur réelle) et n'est **pas un
casino** — c'est du PvP de skill. Le style de la référence est casino ; le
sujet, lui, ne doit jamais l'être. C'est tout l'objet de ces trois variantes.
