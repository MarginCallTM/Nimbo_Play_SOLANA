# DECISIONS.md — Décisions actées (Solana Lottery MVP)

> **Source de vérité du projet.** Ces décisions sont **verrouillées** : ne pas les rediscuter,
> ne pas les « améliorer », ne pas élargir le scope sans accord explicite de l'utilisateur.
> Toute proposition qui contredit ce fichier doit être signalée comme telle avant d'agir.
> Complément de CLAUDE.md (rôle/comportement) et TODO.txt (étapes).

---

## 0. Point de départ : reprise d'un repo existant

> Le projet ne démarre PAS d'une page blanche. Un repo existe :
> `MarginCallTM/Solana_Loto_Rust` (1 commit, janvier 2026).

**Ce qui existe déjà (à reprendre, qualité correcte) :**
- ✅ Un **backend off-chain en Rust + Axum** (PAS de Node/TS) avec PostgreSQL.
- ✅ Architecture en couches propre : `models` / `db/repositories` / `api/handlers` / `dto`.
- ✅ Workspace Cargo configuré ; schéma SQL soigné (contraintes CHECK, index, trigger updated_at, table d'audit `transactions`).
- ✅ Prix stockés en lamports (BIGINT). Logs via `tracing`, erreurs via `anyhow`.

**Ce qui N'EXISTE PAS encore (à construire from scratch) :**
- ❌ Le **programme on-chain Anchor** — le cœur du projet. Rien n'est commencé.
- ❌ Les handlers d'API sont en grande partie vides.
- ❌ Le frontend.

**Écarts connus à réconcilier (voir D9bis, D10) :**
- Le backend actuel suit un modèle **API REST où le client écrit directement en DB**,
  pas le modèle **indexer/events** prévu. À aligner une fois le programme on-chain en place.
- L'indexer était prévu en Node/TS ; l'existant est en Rust. Décision révisée (D10).

**Stratégie validée :** reprendre le backend (gain phases 8-10), construire le programme
Anchor en green-field (phases 1-7), puis réconcilier et brancher le frontend.

---

## 1. Scope du MVP

| # | Décision | Statut |
|---|---|---|
| D1 | Loterie décentralisée full-stack sur Solana, à but **portfolio/pédagogique** | ✅ acté |
| D2 | MVP = **1 ticket = 1 chance, un seul gagnant** (winner-take-all) | ✅ acté |
| D3 | **Pas** de système de numéros à matcher (5+bonusball) au MVP | ✅ hors-scope |
| D4 | **Pas** de modèle LP / house (banque par fournisseurs de liquidité) | ✅ hors-scope |
| D5 | **Pas** de cross-chain / bridging | ✅ hors-scope |

---

## 2. Stack technique (verrouillée)

| # | Décision | Statut |
|---|---|---|
| D6 | Programme on-chain en **Rust + Anchor** | ✅ acté |
| D7 | Tickets payés en **SOL natif** (pas de SPL token au MVP) | ✅ acté |
| D8 | Frontend **Next.js (React)** + `@solana/wallet-adapter` + client Anchor (IDL) | ✅ acté |
| D9 | Base de données **PostgreSQL**, rôle = **cache reconstructible** | ✅ acté |
| D9bis | Modèle cible : DB alimentée par l'**indexer/events**, jamais en écriture directe par le client. **Le backend existant devra être refactoré** vers ce modèle (il écrit actuellement en direct via l'API REST) | 🔧 à réconcilier |
| D10 | Indexer / backend off-chain en **Rust + Axum** (révisé : l'existant est en Rust, pas Node/TS — on garde Rust pour la cohérence du stack et l'apprentissage) | ✅ révisé |
| D11 | Réseau : **devnet uniquement** jusqu'à MVP complet et testé | ✅ acté |

---

## 3. Règles métier (verrouillées)

| # | Décision | Statut |
|---|---|---|
| D12 | `draw_winner` déclenché par **l'authority uniquement** (toi / cron) | ✅ acté |
| D13 | Validation tirage : authority doit être **Signer** ET `has_one = authority` | ✅ acté |
| D14 | Un round se termine sur le **temps** : `end_timestamp` fixé à l'init | ✅ acté |
| D15 | `buy_ticket` refusé si `now >= end_timestamp` | ✅ acté |
| D16 | `draw_winner` refusé si `now < end_timestamp` | ✅ acté |
| D17 | Le temps vient de `Clock::get().unix_timestamp` (échéances larges, pas à la seconde) | ✅ acté |
| D18 | Cas **0 ticket vendu** à l'échéance : fermer sans gagnant, ne jamais planter | ✅ acté |

---

## 4. Architecture on-chain (verrouillée)

### Comptes
| # | Décision | Statut |
|---|---|---|
| D19 | `Lottery` (PDA) — seeds `["lottery", round_id]` — état logique du round | ✅ acté |
| D20 | `Vault` (PDA) — seeds `["vault", round_id]` — détient les SOL, **séparé de l'état** | ✅ acté |
| D20bis | Le Vault n'est **pas créé** à l'init : un PDA ne détenant que des lamports est **financé paresseusement** au 1er `buy_ticket` (le System Program le crée au transfert). À l'init on le déclare seulement pour dériver/stocker son bump. Raison: pattern idiomatique + contourne un bug Anchor 0.31.1 (`init` + `SystemAccount` => macro `Accounts` génère du code cassé `try_from`/`try_from_unchecked`) | ✅ acté |
| D21 | `Ticket` (PDA) — **un compte par achat** (approche scalable, pas de liste inline) | ✅ acté |
| D21bis | **Plusieurs tickets par wallet autorisés** (1 ticket = 1 chance). Ticket PDA seedé par l'**index global** `["ticket", round_id, total_tickets_courant]`, pas par le buyer. Le buyer est stocké dans le champ `Ticket.buyer` | ✅ acté |
| D22 | `LotteryState` enum = `Open` / `Drawing` / `Closed` | ✅ acté |

### Champs de `Lottery` (référence — noms exacts à respecter)
`round_id`, `authority`, `ticket_price`, `total_tickets`, `state`,
`winner` (ou `winner_index`), `pot_amount`, `end_timestamp`, `bump(s)`.

### Instructions (4 au MVP)
| # | Instruction | Rôle |
|---|---|---|
| D23 | `initialize_lottery(round_id, ticket_price, duration)` | authority crée le round, init Lottery + Vault. **round_id fourni en paramètre** (Option A, MVP mono-authority) ; compteur global on-chain = phase 2 si création permissionless |
| D24 | `buy_ticket()` | transfert SOL -> Vault, crée Ticket PDA, incrémente compteurs |
| D25 | `draw_winner()` | authority, après échéance : sélectionne l'index gagnant |
| D26 | `payout()` (ex-`claim_prize`) | **Modèle PUSH** : n'importe qui peut déclencher (un cron off-chain l'appelle automatiquement), mais le pot va **toujours** vers le `buyer` du ticket gagnant, jamais vers le caller. Vérifs: state=Closed, winner_index=Some, ticket.index==winner_index, recipient==ticket.buyer, anti double-claim (claimed). NB: rien n'est "automatique" on-chain (pas de cron natif Solana) — l'automatisme vit dans le cron backend (phase 11.3). Tirage et paiement restent 2 instructions séparées (on ne connaît le gagnant qu'APRÈS draw_winner) |

### Events (au minimum)
| # | Event |
|---|---|
| D27 | `TicketBought`, `WinnerDrawn`, `PrizeClaimed` (+ `LotteryInitialized` optionnel) |

---

## 5. Aléatoire (point sensible — verrouillé)

| # | Décision | Statut |
|---|---|---|
| D28 | MVP : aléatoire **on-chain simple** (slot hash + timestamp + total_tickets) | ✅ acté |
| D29 | La fonction d'aléatoire est **ISOLÉE** derrière une seule fonction/instruction | ✅ acté |
| D30 | Documenté EN CLAIR : c'est **manipulable par un validateur**, **devnet uniquement** | ✅ acté |
| D31 | Migration prévue vers **Switchboard VRF** en phase 2, sans réécrire le reste | ✅ acté |

---

## 6. Ordre de construction (verrouillé)

| # | Décision | Statut |
|---|---|---|
| D32 | Ordre : **Programme + tests -> Indexer/DB -> Frontend** | ✅ acté |
| D33 | **Jalon bloquant** : pas de frontend tant que `anchor test` n'est pas VERT | ✅ acté |
| D34 | Tester chaque instruction y compris ses **cas d'échec** | ✅ acté |
| D35 | Travail **phase par phase** (voir TODO.txt), pas de gros bloc d'un coup | ✅ acté |

---

## 7. Sécurité (non négociable)

| # | Décision | Statut |
|---|---|---|
| D36 | Valider **tous** les comptes (owner, seeds, signer) à chaque instruction | ✅ acté |
| D37 | **Aucune** arithmétique nue sur les lamports : `checked_add` / `checked_mul` | ✅ acté |
| D38 | **Aucun** `unwrap()` sauvage on-chain : erreurs Anchor custom (`#[error_code]`) | ✅ acté |
| D39 | Argent (`Vault`) strictement séparé de l'état logique (`Lottery`) | ✅ acté |
| D40 | Anti double-claim explicite dans `claim_prize` | ✅ acté |

---

## 8. Backlog phase 2 (NE PAS commencer sans accord explicite)

- Switchboard VRF (aléatoire deux-parties, à la Megapot/Pyth Entropy)
- Système de tiers de prix (plusieurs gagnants / paliers)
- Tickets en SPL token
- Page publique « provably fair » / vérification
- Dashboard de stats
- `draw_winner` permissionless
- Déploiement mainnet (uniquement après audit interne sérieux)

---

## 9. Versions réelles de la stack (relevées le 2026-06-17)

- Rust (système) : `rustc 1.95.0` — cargo 1.95.0
- Rust (SBF / build on-chain) : `rustc 1.84.1` (embarqué dans platform-tools v1.51 de la Solana CLI)
- Solana CLI : `3.0.13 (Agave)`
- Anchor : `0.31.1` (CLI via avm + `anchor-lang = "0.31.1"`)
- Node : `v24.10.0`
- Gestionnaire de paquets : `yarn 1.22.22` (JS) — Cargo (Rust)
- Contraintes de norme/structure École 42 éventuelles : aucune connue à ce jour

### D41 — Anchor verrouillé en 0.31.1 (révision de D6) + dépendances épinglées

`anchor build` ne passe PAS avec la stack « tout dernier ». Cause : le compilateur SBF
de la CLI 3.0.13 est en **rustc 1.84.1**, alors que l'écosystème récent exige rustc ≥ 1.85
(édition 2024). Bug d'outillage connu (anza-xyz/agave#8443).

Décision : **rester sur Anchor 0.31.1** (descendu depuis 0.32.1) + **épingler** dans
`programs/lottery/Cargo.lock` les crates transitifs fautifs vers leur dernière version en
édition 2021 / rustc ≤ 1.84 :
`proc-macro-crate 3.2.0`, `blake3 1.8.2`, `zeroize 1.8.1`, `indexmap 2.13.1`,
`unicode-segmentation 1.12.0`.

Conséquences verrouillées :
- ⚠️ **Ne pas lancer `cargo update`** sur le programme sans réépingler (ça recasse le build).
- ✅ **Committer `programs/lottery/Cargo.lock`** (reproductibilité du build).
- 🔁 Réversible : le jour où une CLI Solana embarque un rustc SBF ≥ 1.85, supprimer les pins
  et remonter Anchor à la dernière version.

---

## 10. PIVOT — Écosystème Nimbo Play (jeux P2E de skill) — acté 2026-07-10

> **Pivot majeur.** La loterie (D1–D41) reste valide mais devient une **side-feature** (gacha à skins).
> Produit phare = **écosystème de jeux P2E de skill** sur Solana. 1er jeu = clone slither.io.
> Décisions ci-dessous **verrouillées** au même titre. Complément : CLAUDE.md §0.

### Concept & modèle de jeu
| # | Décision | Statut |
|---|---|---|
| D42 | **Nimbo Play** = écosystème de jeux P2E de **skill** (human vs human, pas vs casino). Loterie reléguée en side-feature/gacha | ✅ acté |
| D43 | 1er jeu = **clone slither.io** ; vision = **portail multi-jeux** (agar.io, fall guys…). **Un seul jeu d'abord** | ✅ acté |
| D44 | **Gameplay OFF-CHAIN** (serveur autoritatif temps réel, pour la fluidité). On-chain = escrow + settlement + anti-rejeu **uniquement** | ✅ acté |
| D45 | Modèle de confiance **assumé** : le serveur off-chain est un **oracle de confiance sur de l'argent réel** (≠ *provably fair* de la loterie). Décentraliser = durcissement mainnet | ✅ acté |
| D46 | Mise d'entrée **VARIABLE** : plus de mise → serpent spawn plus gros (plus de pouvoir / plus de risque) | ✅ acté |
| D47 | **Conservation stricte de la valeur** : aucune création hors des mises. Mort = 90 % cadavre (mangeable) + 10 % pellets. Bouffe ambiante = gameplay only, sans valeur | ✅ acté |
| D48 | **Pas de cash-out instantané** : *extract points* périodiques + **timer de canalisation 4 s** vulnérable | ✅ acté |
| D49 | **Parties à durée limitée** (rounds). Join à tout moment + **repay pour respawn**. Rage-quit/déco = serpent immobile & tuable | ✅ acté |
| D50 | SOL orphelin (cadavres non mangés) en fin de round → **FoodReserve** (PDA), reporté en bouffe des rounds suivants. **DOIT être un vrai transfert de lamports** (dette inter-round), sinon l'invariant de solvabilité par round casse | ✅ acté |

### Architecture on-chain (programme `arena/`, séparé de la loterie)
| # | Décision | Statut |
|---|---|---|
| D51 | Nouveau programme **`programs/arena/`**, aucun état partagé avec la loterie. **Générique / agnostique du jeu** (pour le portail multi-jeux) | ✅ acté |
| D52 | Comptes : `Round` PDA `["round", round_id]`, `Vault` PDA `["vault", round_id]`, `FoodReserve` PDA (global persistant), `ExtractReceipt` PDA `["extract", round_id, nonce]` (anti-rejeu ; création = garde-fou, comme le `Ticket` PDA de la loterie) | ✅ acté |
| D53 | Instructions : `initialize_round`, `join` (dépôt variable permissionless), `settle_extraction` (authority signe), `end_round` (balaie vers FoodReserve) | ✅ acté |
| D54 | Autorisation MVP = **Modèle A** : le serveur **EST l'authority signataire** de `settle_extraction` (réutilise le pattern `draw_winner`). **Modèle B** (attestation ed25519 vérifiée on-chain via programme natif Ed25519 + introspection sysvar Instructions) = durcissement mainnet, plus décentralisé | ✅ acté |
| D55 | Invariants de solvabilité (`require!`) : (1) `amount <= vault.lamports` (filet ultime, tient même si serveur compromis) ; (2) `total_paid <= total_deposited + injecté depuis FoodReserve` | ✅ acté |
| D56 | **Anti-rejeu OBLIGATOIRE** : un `ExtractReceipt` PDA par nonce, `init` échoue si déjà existant → rejeu impossible | ✅ acté |

### Stack technique du jeu
| # | Décision | Statut |
|---|---|---|
| D57 | Client : **PixiJS** (WebGL 2D), boucle RAF **hors React**. React/Next = coquille (wallet, menus, lobby). TypeScript partout | ✅ acté |
| D58 | Transport : **WebSocket** au MVP, **derrière une interface** (→ swap **WebTransport/QUIC** au scale). **Pas de WebRTC.** Sérialisation **binaire** (pas JSON) | ✅ acté |
| D59 | Serveur autoritatif : MVP **Node + Colyseus** (valider le fun vite), réécriture de la sim chaude en **Rust** au scale (pas de pauses GC ; = langage Anchor) | ✅ acté |
| D60 | Netcode : **client-side prediction + server reconciliation + entity interpolation + area-of-interest + partitionnement spatial** | ✅ acté |
| D61 | Web3 : **Sign-In With Solana (SIWS)** pour la session ; **service de settlement Rust** (détient l'authority) ; **indexer réutilisé** (events → Postgres) | ✅ acté |

### Business model & monétisation
| # | Décision | Statut |
|---|---|---|
| D62 | Rake **5,5 %** prélevé **sur l'entrée** (mise 1 SOL → 0.945 au pot, 0.055 maison). Revenu = 5,5 % **garanti du volume brut**. ⚠️ Surveiller rake vs vélocité (« le rake tue les games ») | ✅ acté |
| D63 | Skins **NFT cosmétiques** (Metaplex) — **cosmétique-only = pas de pay-to-win**. Entitlement on-chain, rendu client. Marketplace primaire + secondaire (royalties). **APRÈS** un jeu peuplé | ✅ acté |
| D64 | Loterie = **gacha à skins** (réutilise le programme `lottery`). → **DÉBLOQUE PROD.1** : sur mainnet avec skins à valeur réelle, **VRF Switchboard obligatoire** (l'aléa on-chain simple est manipulable) | ✅ acté |
| D65 | **Portail multi-jeux** (jeux.fr-like) : le primitif escrow étant agnostique, un 2e jeu (agar.io) valide la généricité. Vision LT, **pas MVP** | ✅ acté |

### Anti-triche, confiance & mainnet
| # | Décision | Statut |
|---|---|---|
| D66 | Baseline anti-triche = **serveur autoritatif** (client n'envoie QUE ses inputs). **Matchmaking par tier** de mise/skill (segrège whales/fish/bots ; résout shark-vs-fish et le whale-stomping du buy-in variable) | ✅ acté |
| D67 | Collusion-nourrissage : **désamorcée par le buy-in variable** (acheter un géant domine le feed + taxe 10 %). Reste best-effort ; **bots = mur n°1** | ✅ acté |
| D68 | **Juridique : PARKÉ par décision explicite de l'utilisateur** (domicilié Dubai). **Ne plus soulever.** Rappel neutre acté une fois : Dubai a VARA, l'exposition suit les joueurs — mais c'est le call du founder | ✅ acté (parké) |
| D69 | Discipline : **un jeu fun d'abord** (prototype jetable, zéro Solana), puis escrow générique, puis intégration, puis monétisation. **Testnet avant mainnet** | ✅ acté |
| D70 | Résilience/custody (durcissement mainnet) : si le serveur crash en pleine partie, les fonds ne doivent pas rester bloqués → **timeout/remboursement on-chain**. Clé authority en **KMS/HSM + multisig**. Settlement optimiste / fraud-proofs | ✅ acté |

### Backlog phase 2 spécifique Nimbo Play (NE PAS commencer sans accord)
- Modèle B (attestation ed25519) pour un settlement décentralisé
- Réécriture Rust du serveur de simulation (densité / coût)
- Portail multi-jeux + 2e jeu (agar.io)
- Marketplace de skins secondaire + royalties
- Détection de bots avancée (ML) + anti-Sybil sérieux
