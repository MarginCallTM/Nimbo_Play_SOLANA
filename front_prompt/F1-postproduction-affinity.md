# F1 — Post-production du hero dans Affinity 3

> Procédure pour finir l'asset avant intégration. Couvre F1.1 → F1.9 du
> [FrontTODO.txt](../FrontTODO.txt).
>
> **Affinity 3.2.2** (app unifiée : les anciens Designer / Photo / Publisher
> sont désormais des modes dans une seule app). ⚠️ Les techniques ci-dessous
> sont stables d'une version à l'autre, mais **le libellé exact de certains
> menus a pu bouger** dans la version unifiée — si un intitulé ne correspond
> pas, cherche l'équivalent, la logique reste la même.
>
> **Tout est non destructif** : filtres live + masques. Tu peux revenir sur
> chaque réglage jusqu'à l'export.

---

## F1.1 — Le fichier de départ

**Retenu :** `~/Downloads/Gemini_Generated_Image_z0rwzpz0rwzpz0rw.jpeg`
(1376 × 768) — la dernière génération, mur de feu haut et flammes en découpe.

**Réserve :** `Gemini_Generated_Image_ovys43ovys43ovys.jpeg` — l'avant-dernière,
plus de respiration mais mur de feu plus bas. À garder pour un A/B une fois le
vrai texte posé.

**Avant de commencer :** duplique le JPEG source ailleurs et travaille sur la
copie. On ne retouche jamais l'original.

---

## Étape 0 — Ouvrir et agrandir le document

L'image fait 1376 px de large. Un hero plein écran sur un 27" Retina demande
~3840 px. On agrandit **d'abord**, pour que tous les réglages suivants (rayons
de flou, taille des orbes) soient calibrés à la résolution finale.

1. Ouvre le JPEG dans Affinity.
2. **Document → Redimensionner le document** (*Resize Document*).
3. Largeur **3840 px**, hauteur liée (→ 2144 px).
4. Rééchantillonnage : **Lanczos 3 (non-séparable)** si proposé.
5. Valide.

**Pourquoi ça marche ici alors que l'upscale rate souvent :** ton image est
faite d'aplats et de dégradés lisses, sans texture fine ni détail à
halluciner. C'est le cas le plus facile pour un rééchantillonnage. Le seul
élément qui va ramollir, c'est le grain généré — et justement, on le remplace
en fin de parcours.

> Si Affinity 3 propose un **agrandissement par ML / IA**, essaie-le et compare
> à 100 % sur l'écran de la borne. Je ne sais pas si cette version l'embarque,
> vérifie dans la boîte de dialogue.

---

## Étape 1 — Profondeur de champ (F1.2)

C'est **le geste qui change le plus l'image**. Le modèle a refusé de le faire
trois fois ; à la main c'est deux minutes.

L'idée : flouter **uniquement** les nuages du tout premier plan (bas-gauche et
bas-droite, ceux qui touchent les bords), pendant que le feu et la borne
restent parfaitement nets. C'est ce décalage qui crée l'illusion d'espace.

1. Sélectionne le calque image.
2. **Calque → Nouveau filtre live → Flou → Flou gaussien**
   (*Layer → New Live Filter Layer → Blur → Gaussian Blur*).
3. Rayon : commence à **20–25 px** (on est à 3840 px de large, il faut y aller
   franchement — à 1376 px ce serait 8-10 px).
4. Le filtre s'applique partout, c'est normal : on va le masquer.
5. Sélectionne le **masque du filtre live** (les filtres live ont leur propre
   masque intégré).
6. **Édition → Tout sélectionner**, puis remplis le masque en **noir** — le
   flou disparaît entièrement.
7. Prends le **pinceau** (*Paint Brush*), couleur **blanche**, dureté **0 %**,
   opacité **~40 %**, un très gros diamètre (600–900 px).
8. Peins sur les nuages du **coin bas-gauche** et du **coin bas-droite**, en
   partant des bords vers le centre. Repasse plusieurs fois sur l'extrême bord
   pour accentuer.

**Les règles :**
- Le flou est **maximal aux bords du cadre** et se dissipe vers le centre.
- **Ne touche jamais** le feu, la borne, ni les nuages qui l'entourent : ils
  restent nets.
- Une transition progressive, jamais de frontière visible. Si tu vois une
  démarcation, baisse l'opacité du pinceau et repasse en plusieurs couches.

**Vérification :** zoome à 50 %, plisse les yeux. Tu dois sentir deux plans —
un avant flou, un fond net — sans identifier où l'un s'arrête.

---

## Étape 2 — Les orbes dorées (F1.3)

Deux gestes : enlever celle qui est ratée, en redessiner de propres.

### 2a. Supprimer l'orbe plaquée sur le nuage de droite

Elle ressemble à une pièce collée sur le nuage — le modèle l'a placée là deux
générations de suite.

1. Passe en mode **Pixel / Photo**.
2. Prends le **pinceau de correction** (*Inpainting Brush Tool*).
3. Diamètre légèrement plus grand que l'orbe.
4. Peins dessus en un seul geste. Affinity reconstruit le nuage à partir des
   pixels alentour.
5. Si le résultat bave : annule, et utilise plutôt le **tampon de clonage**
   (*Clone Brush*) — ⌥-clic sur une zone de nuage propre juste à côté, puis
   peins par-dessus l'orbe.

Le nuage est un dégradé doux et régulier : les deux méthodes s'en sortent très
bien. C'est le cas favorable.

### 2b. Redessiner 2–3 orbes propres

**Sur un nouveau calque**, jamais sur l'image.

1. Outil **Ellipse**, ⇧ pour un cercle parfait.
2. Remplissage : dégradé radial, `#ffd98a` en haut-gauche vers `#e8a93f` en
   bas-droite (une orbe n'est pas un aplat, elle a un volume).
3. Ajoute une **lueur externe** (*Outer Glow*) dans les effets de calque :
   couleur `#ffcc66`, rayon large, opacité ~50 %.
4. Duplique 2 fois, **tailles nettement différentes** (ex. 40 px, 65 px, 90 px
   à cette résolution).

**Le placement, c'est là que ça se joue :**
- Uniquement dans le **noir ouvert** de la moitié haute.
- **Jamais** sur un nuage, jamais sur le feu.
- Jamais alignées, jamais à distance égale. Cherche un triangle irrégulier.
- Une seule doit être franchement plus grosse que les autres.

Optionnel, pour la profondeur : mets un léger flou gaussien (5–8 px) sur la
plus grosse, comme si elle était plus proche de l'objectif.

---

## Étape 3 — Asymétrie (F1.4) — optionnel, à évaluer

Les deux masses nuageuses sont presque symétriques, ce qui fige la composition.
Le correctif rapide : sélectionne le nuage de gauche, agrandis-le de 10-15 % et
remonte-le légèrement.

**Mon avis : saute cette étape pour l'instant.** Le gain est réel mais faible,
et le risque de créer une jointure visible est élevé. Tu jugeras mieux une fois
le texte posé par-dessus — si la composition paraît statique à ce moment-là, tu
reviendras.

---

## Étape 4 — Le grain (F1.6)

**Ne le fais PAS dans Affinity.** Fais-le en CSS.

Raison : un grain baké dans l'image est fixe. Sur un écran Retina (DPR 2 ou 3),
il est mécaniquement agrandi et redevient pâteux — exactement le problème qu'on
essaie de résoudre. Un grain CSS est recalculé par le navigateur à la densité
réelle de l'écran, donc **net partout**. Et il couvre toute la section, texte
compris, comme dans la référence.

L'overlay est prêt dans [03b-arcade-cabinet-4k.md](03b-arcade-cabinet-4k.md)
(filtre SVG `feTurbulence`). Il sera posé en F4.9.

> **Si tu tiens quand même à un grain baké** (pour un usage hors web : og-image,
> réseaux sociaux, print) : nouveau calque rempli de gris 50 %, **Filtres →
> Bruit → Ajouter du bruit** (monochromatique, ~8 %), mode de fusion
> **Incrustation** (*Overlay*), opacité 12–18 %. À faire en tout dernier, après
> l'agrandissement.

---

## Étape 5 — Export (F1.7)

Quatre fichiers, vers **`app/public/hero/`**.

| Fichier | Largeur | Format | Qualité |
|---|---|---|---|
| `hero-arcade-3840.webp` | 3840 | WebP | 82 |
| `hero-arcade-2560.webp` | 2560 | WebP | 82 |
| `hero-arcade-3840.avif` | 3840 | AVIF | 55–60 |
| `hero-arcade-2560.avif` | 2560 | AVIF | 55–60 |

**Jamais de PNG** : plusieurs Mo de dégradés, la home serait plombée.

**Budget de poids (F12.1) : viser < 400 Ko** pour le 3840. Si tu dépasses,
descends la qualité WebP à 78 avant de réduire les dimensions — sur des aplats
et des dégradés, la perte est invisible.

Le hero est l'image **LCP** de la page : c'est elle qui détermine la vitesse
perçue du site. Ce budget n'est pas cosmétique.

> Si Affinity n'exporte pas l'AVIF, ce n'est pas bloquant : les deux WebP
> suffisent pour démarrer. On ajoutera l'AVIF plus tard, c'est juste ~20 % de
> poids en moins.

---

## Étape 6 — Variante mobile (F1.8)

Une image 16:9 sur un écran portrait devient une bande fine où l'on ne
distingue plus rien.

1. Repars du document 3840.
2. **Document → Redimensionner la zone de travail** (*Resize Canvas*), format
   **4:5** ou **1:1**, ancré au centre.
3. Vérifie que la borne reste **entière et centrée**, et qu'il reste du noir
   au-dessus pour le texte.
4. Si le recadrage coupe trop les nuages, tu peux les retailler — ou remettre
   cette variante à plus tard.
5. Exporte `hero-arcade-mobile-1200.webp` (1200 px de large).

**Alternative si le recadrage centré s'en sort bien :** pas de fichier
supplémentaire, un simple `object-position` en CSS suffit. À trancher en F11.1,
en regardant sur un vrai téléphone.

---

## Étape 7 — Extraire la vraie palette (F1.9) ⭐

**C'est l'étape la plus importante pour la suite** : elle alimente F3, la
charte, qui bloque tout le reste du chantier.

On relève les couleurs **réellement présentes dans l'image finale**, pas les
valeurs qu'on avait écrites dans le prompt (le modèle les a interprétées).

Avec la **pipette** (*Colour Picker*, dans le panneau Couleur), relève et note
la valeur hex de :

| À relever | Où piquer |
|---|---|
| Noir du fond | le haut du cadre, loin de toute lueur |
| Coral clair du feu | le cœur lumineux, en bas du mur |
| Coral saturé | le haut des flammes |
| Indigo des nuages | une face **éclairée**, tournée vers le feu |
| Violet des nuages | une face **dans l'ombre** |
| Liseré rose | l'arête d'un nuage face au feu |
| Indigo de la borne | la face avant |
| Or | une orbe dorée |
| Bleu de l'écran | le tracé bleu |
| Rose de l'écran | le tracé rose |

Note-les dans un fichier texte, ou crée-les en **nuancier** dans Affinity
(*Palette de document*) — tu pourras le réutiliser pour le logo (F5.5) et
l'og-image (F13.2).

**Donne-moi cette liste** : je la convertis en tokens `oklch` et je te prépare
la proposition de charte F3, avec les contrastes vérifiés.

---

## Récapitulatif de l'ordre

```
0. Agrandir à 3840 px          ← d'abord, pour calibrer le reste
1. Flou de premier plan         ← le geste qui compte le plus
2. Orbes : effacer + redessiner
3. Asymétrie                    ← à sauter pour l'instant
4. Grain                        ← PAS ici : en CSS, en F4.9
5. Export WebP (+ AVIF)         ← < 400 Ko
6. Variante mobile              ← ou reporté en F11.1
7. Relever la palette           ← débloque F3
```

Compte 20 à 30 minutes. Les étapes 1, 2 et 7 sont les seules indispensables
avant de créer la branche.

---

## Quand s'arrêter

L'objectif n'est pas d'égaler la référence au pixel près — c'est d'avoir un
asset **propre, léger et définitif**, pour intégrer le vrai fichier plutôt
qu'un brouillon qu'il faudra remplacer.

Si après ces étapes l'écart avec la référence te gêne encore, le levier
restant n'est plus la retouche : c'est un illustrateur (cf. la fin de
[03c](03c-arcade-painterly.md)). Mais rien n'empêche de construire tout le
front avec cet asset et de le remplacer plus tard — le CSS ne changera pas.
