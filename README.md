# Double Jeu

Jeu d'espions original, jouable au clavier dans le navigateur, en ligne à deux joueurs.

## Lancer

    npm install
    npm start

Puis ouvre http://localhost:3000 . Pour jouer sur le même réseau, l'autre joueur ouvre `http://<ip-de-ta-machine>:3000`.

## Jouer en ligne (hors de chez toi)

Le serveur est un simple programme Node (WebSocket) : héberge-le sur un service qui accepte Node
(Render, Railway, Fly.io, un VPS…). Commande de démarrage : `npm start`. Le port est lu dans la variable `PORT`.
Le site fonctionne en https/wss automatiquement.

## Commandes

| Touche | Action |
|---|---|
| ZQSD / WASD / flèches | Se déplacer |
| E | Fouiller un meuble (immobile ~1 s) / monter dans l'hélico |
| 1 / 2 / 3 | Poser une bombe / un ressort / de la colle sur un meuble |
| R | Désamorcer le piège du meuble devant toi (3 pinces) |
| Espace | Assommer l'adversaire à portée |

## Règles

- 4 objets secrets sont cachés dans les meubles du bâtiment (9 pièces). On ne voit que la pièce où l'on se trouve.
- Rassemble les 4 objets, va à l'hélico (pièce centrale) et appuie sur E pour gagner.
- Un meuble piégé par l'adversaire se déclenche quand tu le fouilles : bombe (sonné 3,5 s, objets perdus),
  ressort (sonné 2,5 s, un objet perdu), colle (ralenti 7 s). Tes propres pièges sont sans effet sur toi.
- Un coup de matraque assomme 1,6 s et fait lâcher un objet dans la pièce.
- Au bout de 4 minutes, celui qui a le plus d'objets gagne.

## Réglages

Constantes en haut de `server.js` (durée, vitesse, délais des actions, cooldowns, nombre de pinces…).
