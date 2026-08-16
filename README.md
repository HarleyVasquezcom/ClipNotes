# ClipNotes — clip a note to anything

Clip the page you are reading plus a note of your own into a private notebook that lives only in your Chrome: search across clips and notes, and JSON or Markdown export you own. Page text is captured only when you press the button — no host permissions, no background tracking.

Landing page: `https://clipnotes-jade.vercel.app`

## What it does

- "Clip this page" saves the current page — title, URL and readable text — into your private notebook (`chrome.storage`).
- Every clip has its own note box: write your thoughts under the page and save them with the clip.
- "Blank note" starts an empty note for ideas that have no page yet; search covers clips, URLs and notes together.
- Export the whole notebook as Markdown or JSON — a file you own.
- Cap of 300 notes keeps storage light; the oldest notes are pruned first.
- Page text capture tries a plain fetch first, and only falls back to Chrome's read-the-active-tab API; when neither works, the title and URL are saved so your note is never lost.

## Permissions (justified)

| Permission | Why |
| --- | --- |
| `storage` | the notebook and language setting live in `chrome.storage.local` |
| `tabs` | reads the active tab's URL/title when you click the button |
| `activeTab` + `scripting` | reads page text only for the tab you clicked on (only used when a plain fetch is blocked) |

No `host_permissions`: no site ever gets persistent access.

## Install

1. Download `clipnotes.zip` (link on the landing page) and unpack it somewhere permanent.
2. Open `chrome://extensions` and enable Developer mode.
3. Click "Load unpacked" and select the folder.
4. Open the popup on the page you want to keep, click "Clip this page" and add your note.

---

# ClipNotes — sujeta una nota a cualquier cosa

Sujeta la página que estás leyendo más una nota tuya en un cuaderno privado que vive solo en tu Chrome: búsqueda entre clips y notas, y exportación en JSON o Markdown que te pertenece. El texto de la página solo se captura cuando pulsas el botón — sin permisos de host, sin seguimiento en segundo plano.

Página de aterrizaje: `https://clipnotes-jade.vercel.app`

## Qué hace

- "Cortar esta página" guarda la página actual — título, URL y texto legible — en tu cuaderno privado (`chrome.storage`).
- Cada corte tiene su caja de notas: escribe tus pensamientos bajo la página y guárdalos con el corte.
- "Nota en blanco" empieza una nota vacía para ideas que aún no tienen página; la búsqueda cubre cortes, URLs y notas a la vez.
- Exporta el cuaderno completo en Markdown o JSON — un archivo tuyo.
- Límite de 300 notas mantiene el almacenamiento liviano; se podan primero las más antiguas.
- La captura del texto intenta primero un `fetch` simple y solo cae a la API de lectura de la pestaña activa de Chrome; si nada funciona, se guardan el título y la URL para que tu nota nunca se pierda.

## Permisos (justificados)

| Permiso | Por qué |
| --- | --- |
| `storage` | el cuaderno y el idioma viven en `chrome.storage.local` |
| `tabs` | lee la URL/título de la pestaña activa al pulsar el botón |
| `activeTab` + `scripting` | lee el texto solo de la pestaña en la que hiciste clic (solo si un `fetch` simple es bloqueado) |

Sin `host_permissions`: ningún sitio obtiene jamás acceso persistente.

## Instalación

1. Descarga `clipnotes.zip` (enlace en la página de aterrizaje) y descomprímelo en un lugar permanente.
2. Abre `chrome://extensions` y activa el modo desarrollador.
3. Haz clic en "Cargar descomprimida" y elige la carpeta.
4. Abre el popup en la página que quieras conservar, pulsa "Cortar esta página" y añade tu nota.

## Credit / Créditos

Built by [Harley Vásquez](https://www.linkedin.com/in/harleyvasquez/) — Creado por Harley Vásquez.