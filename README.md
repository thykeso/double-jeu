# Double Jeu

Jeu d'espions original, jouable au clavier dans le navigateur, en ligne de 2 à 5 joueurs (bots possibles).

## Lancer

    npm install
    npm start

Puis ouvre http://localhost:3000 . Sur le même réseau, les autres ouvrent `http://<ip-de-ta-machine>:3000`.
(Sous Windows PowerShell, si `npm` est bloqué : utilise l'Invite de commandes `cmd`.)

## Héberger en ligne

Programme Node (WebSocket) sans base de données : Render, Railway, Fly.io, un VPS…
Commande de démarrage : `npm start`. Le port est lu dans la variable `PORT`. Une seule instance suffit
(et est obligatoire : les parties vivent en mémoire).

## Modes

- **Contre un bot** : crée un salon avec un bot déjà présent. Tu peux ensuite changer les réglages, ajouter d'autres bots
  ou inviter des amis, puis tu lances avec « Jouer ».
- **Partie rapide** : mise en relation automatique avec le prochain joueur, réglages par défaut, démarrage immédiat.
- **Salon** : tu crées un salon (code de 4 lettres + lien d'invitation). Tu es l'hôte : tu règles la partie,
  tu vois la liste des joueurs présents, tu peux exclure un joueur ou un bot, et la partie ne démarre que quand
  tu appuies sur « Jouer » (minimum 2 joueurs, bots compris). À la fin, tout le monde peut revenir au salon.

## Réglages du salon (hôte)

| Réglage | Valeurs |
|---|---|
| Objets à trouver | 1 à 10 |
| Taille de la carte | 2×3, 3×3, 3×4, 4×4, 5×5 pièces |
| Durée | 2, 3, 4, 5, 7 ou 10 minutes |
| Joueurs | 2 à 5 (bots compris) |

Les réglages sont validés par le serveur.

## Commandes

| Touche | Action |
|---|---|
| ZQSD / WASD / flèches | Se déplacer |
| E | Fouiller un meuble (immobile ~1 s) / monter dans l'hélico |
| 1 / 2 / 3 | Poser une bombe / un ressort / de la colle sur un meuble |
| R | Désamorcer le piège du meuble devant toi (3 pinces) |
| Espace | Assommer un agent à portée |

## Règles

- Les objets secrets sont cachés dans les meubles. On ne voit que la pièce où l'on se trouve.
- Rassemble tous les objets, va à l'hélico (pièce centrale) et appuie sur E pour gagner.
- Un meuble piégé se déclenche quand un autre joueur que le poseur le fouille : bombe (sonné 3,5 s, objets perdus),
  ressort (sonné 2,5 s, un objet perdu), colle (ralenti 7 s). Le poseur est immunisé.
- Un coup de matraque assomme 1,6 s et fait lâcher un objet dans la pièce.
- Temps écoulé : celui qui a le plus d'objets gagne (égalité possible). Si tous les autres joueurs partent, tu gagnes par forfait.

## Les bots

Les bots jouent avec les mêmes règles que toi : ils ne connaissent ni l'emplacement des objets ni tes pièges,
fouillent les meubles les uns après les autres, posent des pièges, désamorcent parfois et se battent.
Réglages dans `server.js` (`BOT_TRAP_P`, `BOT_AGGR`).

## Réglages techniques

Constantes en haut de `server.js` (vitesse, délais des actions, cooldowns, nombre de pinces…).
