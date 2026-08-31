# Variante 2 — Le serpent néon

**Substitution :** la roulette → **un serpent géant** qui jaillit des nuages,
corps fait de segments lumineux, avalant une traînée de pellets.

**Ce que ça raconte.** Le jeu, sans détour. Pas de métaphore financière, pas de
disque ambigu : on voit une créature, on comprend qu'on va piloter ça. C'est
aussi la variante qui te donne une **mascotte** — donc un logo possible, des
skins, un avatar Twitter, une icône d'app.

**Où ça colle.** Partout. C'est la plus polyvalente et la plus déclinable.

**Pourquoi ça marche avec la référence.** Dans l'image d'origine, la roulette
émerge des nuages en occupant le bas du cadre et en montant vers le texte. Un
serpent dressé fait exactement ce mouvement, en mieux : la verticalité est
naturelle au sujet, là où la roulette est une forme plate.

**À surveiller.** Le risque est le **kitsch dragon chinois**. Il faut que ça
reste géométrique et lisse — des segments simples, une tête ronde minimaliste,
zéro écaille, zéro dent, zéro détail organique. C'est un serpent de jeu
vectoriel, pas un serpent d'heroic fantasy.

---

## PROMPT

```
A smooth, stylized, minimal graphic illustration featuring flat, vector-like shapes overlaid with a subtle, soft grainy texture. NO harsh black ink lines, NO comic-book hatching, and NO hyper-detailed line-work. The background is a solid, deeply textured, grainy dark void (#08080c). Dominating the center-bottom is a blazing backdrop of flat, stylized neon flames in smooth salmon-pink (#ff7878) and warm orange (#ff9e78) without complex shading, framed on the lower left and right corners by soft, pillowy, smooth smoke clouds in vibrant indigo (#4342d6) and neon purple (#673ab7). The central elements are positioned at the bottom center in front of the flames, bursting upwards with dynamic motion. The rendering uses bold, saturated flat colors with clean edges, utilizing soft grain rather than gritty halftone shading. The overall mood is energetic, modern, and clean. NO casino imagery whatsoever: no roulette wheel, no chips, no dice, no playing cards, no gems.

Color combination [ Background is deep grainy black (#08080c), flames are flat neon salmon-pink (#ff7878) and warm orange (#ff9e78), smoke is soft vibrant indigo (#4342d6) and neon purple (#673ab7) ]
Elements [ A large neon-blue serpent at the bottom center, coiling out of the smoke clouds and rearing upward with dynamic motion; its body is a smooth chain of soft glowing rounded segments fading from electric blue (#3981f6) to deep indigo (#2b6fd6), with clean edges and no scales and no texture; a simple minimal rounded head with a single bright dot for an eye; it is surging through a curving trail of small floating orbs of light in neon pink, cyan, green, yellow, purple and orange, with a few larger golden orbs (#ffcc66) drifting upward around it ]
Detail density [ Minimal to moderate, relying on bold, smooth shapes and soft gradients rather than intricate line-work or complex details ]
Empty space [ Top 55% visually empty; keep this area filled with the same deep grainy black (#08080c) texture, but place no flames, smoke, or floating debris there ]
Aspect ratio [ 16:9 ]
```

---

## Réglages à essayer si le premier jet ne va pas

- **Trop organique / dragon :** ajouter en fin de la description de style
  `The serpent must read as a simple geometric game sprite, not a mythological
  creature: no fangs, no scales, no horns, no whiskers.`
- **Deux serpents (le PvP) :** remplacer le début d'Elements par `Two large neon
  serpents at the bottom center — one electric blue (#3981f6), one hot pink
  (#ff79c6) — coiling out of the smoke and circling each other`.
- **Renforcer l'enjeu :** ajouter en fin d'Elements `; a small glowing golden
  ring resting on the dark floor beneath the serpent`.
- **Version mascotte / logo :** passer Aspect ratio à `1:1`, supprimer les
  flammes et les nuages, garder le serpent seul lové sur le fond noir texturé.
