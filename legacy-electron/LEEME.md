# Mis Cercas 2.3.0

Organiza tu escritorio de Windows con cercas: cuadros semitransparentes donde agrupas accesos directos, archivos y carpetas.

## Instalar (recomendado)

Usa el archivo **MisCercas-Setup-2.3.0.exe** (se entrega aparte de este .zip, en 3 partes: deja las 3 y **Unir-Instalador-2.3.0.bat** en la misma carpeta y abre el .bat; junta las partes, comprueba que estén completas y abre el instalador):

1. Cierra la versión que tengas abierta: icono de la bandeja → **Salir**.
2. Haz doble clic en el instalador y sigue los pasos. Puedes instalarlo solo para ti (no pide permisos de administrador) o para todos los usuarios.
3. Al terminar crea un acceso directo en el escritorio y en el menú Inicio, y puede abrir el programa al finalizar.

Para desinstalar: Configuración de Windows → Aplicaciones → **Mis Cercas**. La desinstalación no borra tus cercas ni tus ajustes (están en `%APPDATA%\mis-cercas`), así que al reinstalar todo sigue como lo dejaste.

Si Windows SmartScreen avisa «Windows protegió su PC», elige **Más información** y luego **Ejecutar de todas formas**: el instalador no está firmado digitalmente.

## Empezar sin instalar

1. Descomprime esta carpeta completa.
2. Haz doble clic en **Iniciar.bat**.

La primera vez descarga Electron (unos 110 MB, con barra de progreso). Las siguientes abre al instante.
Si ya tienes la carpeta `electron` de la versión anterior, cópiala dentro de esta y no descargará nada.

**Si ya usabas la 2.0:** descomprime encima de la carpeta anterior (o copia `electron` a la nueva). Tus cercas y ajustes no se pierden: viven en `%APPDATA%\mis-cercas`.

## Crear el .exe

Haz doble clic en **Crear-EXE.bat**. Al terminar encontrarás:

- La carpeta `dist\Mis Cercas-win32-x64` con **Mis Cercas.exe** (puedes copiarla completa a donde quieras).
- Un acceso directo "Mis Cercas" en tu escritorio.

Con Node.js instalado, el .exe lleva el icono y los datos del programa. Sin Node.js se crea igual, pero el archivo conserva el icono genérico (el acceso directo sí lleva el icono propio).

Para desarrolladores: `npm install` y luego `npm start` (probar), `npm run pack` (crear el .exe) o `npm run dist` (crear el instalador en `dist-installer`).

## Novedades de la 2.3, 2.2 y 2.1

- **2.3.0**: **sin iconos duplicados**. Los accesos directos y archivos del Escritorio que pongas en una cerca se **ocultan del Escritorio** (se les pone el atributo «oculto» de Windows; no se borran ni se mueven). Puedes **moverlos a otra cerca** arrastrándolos, y para **sacarlos** arrástralos fuera de las cercas (o clic derecho → *Sacar de la cerca*): vuelven a verse en el Escritorio. Se controla en Configuración → Comportamiento o desde el icono de la bandeja; al desactivarlo todo vuelve a verse. Solo se vuelve a mostrar lo que ocultó Mis Cercas. Los accesos directos del Escritorio público (de todos los usuarios) piden permisos de administrador una vez. Si en el Explorador tienes activado Ver → Mostrar → *Elementos ocultos*, esos iconos se verán atenuados en el Escritorio. Importante: si desinstalas Mis Cercas, antes desactiva este ajuste para que todo vuelva a verse.
- **2.3.0**: si Windows mueve el Escritorio (por ejemplo a OneDrive) y los accesos directos salen tachados, Mis Cercas los vuelve a encontrar solo y corrige la ruta guardada. Los no encontrados quedan anotados en el registro de errores.
- **2.2.5**: iconos de accesos directos leídos directamente de Windows (como el Explorador), que arregla Office, Roblox, Helium y similares.
- **2.2.3**: **alinear y ordenar cercas**. Clic derecho en una cerca → *Alinear y ordenar*: igualar tamaño (o solo ancho/alto) de todas a esa cerca, alinear por izquierda/arriba/derecha/abajo, apilar en columna u ordenar todas en cuadrícula (también desde el icono de la bandeja). Además hay un **imán** (Configuración → Comportamiento): al soltar o cambiar el tamaño de una cerca se pega a los bordes de las demás y a los de la pantalla. Los iconos de programas que salían genéricos se buscan por otras vías, y la selección de un elemento se quita al hacer clic fuera de la cerca (escritorio u otra ventana).
- **2.2.2**: los accesos directos de programas y juegos ahora muestran su icono real (antes salía un documento genérico). El tema se elige desde una lista desplegable compacta en lugar de la galería de miniaturas.

- **Barra de título plana (2.2)**: todos los temas se ven ahora con colores lisos, sin degradado brillante, sin línea luminosa en el borde y sin sombra en el texto del título. Si prefieres el aspecto anterior, en Configuración → Apariencia → **Acabado** elige «Con relieve».
- **34 temas** en cuatro grupos (Configuración → Apariencia):
  - *Claros*: Claro, Papel, Sakura, Menta, Cielo, Lavanda, Durazno.
  - *Oscuros*: Oscuro, Medianoche, Grafito, Negro puro, Bosque, Océano, Vino, Moka, Drácula, Nord, Solarized, Monokai, Gruvbox, Tokyo Night, Catppuccin, Rosé Pine, GitHub.
  - *Color*: Neón, Matrix, Atardecer, Aurora, Alto contraste, Retro 95.
  - *Cristal* (barra de título translúcida): Cristal oscuro, Cristal claro, Escarcha y Humo (barra casi transparente).
  - Además queda el modo **Automático**, que sigue el modo claro u oscuro de Windows.
- **Barra de título a tu gusto**: en Apariencia puedes forzar cualquier tema a *Según el tema*, *Sólida*, *Translúcida* o *Transparente*. La transparencia general sigue controlándose con el deslizador. En el acabado plano, la barra translúcida conserva un mínimo de opacidad para que el título siempre se lea, aunque bajes mucho la transparencia del fondo.
- **Color de acento**: por defecto cada tema trae el suyo; si eliges otro color, se respeta en todos los temas (la opción «Del tema» junto a los colores vuelve al original).
- **Iconos como los de Windows**: ahora se piden al propio Windows, así una carpeta se ve igual que en el Explorador (antes algunas salían con el icono de una unidad). Si Windows no responde, se dibuja una carpeta o un archivo genérico.
- **«Mostrar escritorio» (Win+D)**: las cercas ya no desaparecen. Mientras el escritorio está visible pasan al frente, y al volver a tus ventanas regresan a su sitio, detrás de ellas.

## Si las cercas siguen desapareciendo con Win+D

La detección usa una pieza pequeña incluida en `src\vendor\koffi` (biblioteca koffi, licencia MIT) para consultar el orden de ventanas de Windows. Si no pudiera cargarse, la app funciona igual pero sin esta protección. Soluciones:

1. **Configuración → Comportamiento → Cercas siempre al frente.** Las cercas quedan siempre por encima de todas las ventanas: sobreviven a Win+D, pero también tapan lo que tengas abierto.
2. O bien, solo para una cerca: clic derecho → **Mantener encima de otras ventanas**.
3. Para diagnosticar: icono de la bandeja → **Ver registro de errores**. Busca líneas que digan «Detección de "Mostrar escritorio" activa» y «Mostrar escritorio detectado». Si aparece un aviso de que no se pudo cargar el acceso a Windows, ese mensaje explica el motivo.

## Qué puede hacer

- **Cercas**: arrastra archivos, carpetas o accesos directos dentro. Se pueden reordenar y mover de una cerca a otra.
- **Portales de carpeta**: una cerca que muestra el contenido real de una carpeta (Escritorio, Descargas, Documentos, Imágenes o la que elijas), con filtros (documentos, imágenes, programas…) y orden por nombre, fecha, tamaño o tipo.
- **Enrollar**: botón ▾ o doble clic en la barra de título. También puede enrollarse sola al salir el ratón.
- **Bloquear** posición y tamaño, **mantener encima** de otras ventanas, colores por cerca, vista de cuadrícula o lista.
- **Disposiciones**: guarda y restaura la posición de todas tus cercas (menú del icono de la bandeja).
- **Configuración**: temas, color de acento, estilo de la barra de título, transparencia, tamaño de iconos, atajo de teclado, iniciar con Windows, exportar e importar.

## Atajos

| Acción | Atajo |
| --- | --- |
| Mostrar u ocultar todas las cercas | `Ctrl + Alt + F` (se puede cambiar) |
| Moverse entre elementos | Flechas, `Inicio`, `Fin` |
| Abrir | `Enter` o doble clic |
| Cambiar nombre del elemento o de la cerca | `F2` |
| Quitar el elemento de la cerca | `Supr` |
| Opciones de la cerca | Clic derecho en la cerca o en la barra de título |

## Consejos

- **Peso (unos 230 MB instalado):** Mis Cercas está hecho con Electron, que lleva dentro su propio navegador (Chromium); solo ese motor ocupa unos 190 MB. Tu código, los 34 temas y todo lo demás suman poco más de 1 MB, así que quitar temas no cambia el peso. Para bajar mucho más habría que reescribir el programa en nativo (C# o Rust).

- Para que no se dupliquen los iconos, oculta los del escritorio: clic derecho en el escritorio → Ver → Mostrar iconos del escritorio.
- Si Windows SmartScreen avisa al abrir el .exe, elige "Más información" y luego "Ejecutar de todas formas" (el programa no está firmado digitalmente).
- Tus datos están en `%APPDATA%\mis-cercas` (también desde el icono de la bandeja → Abrir carpeta de datos).
- Si algo falla, el icono de la bandeja tiene "Ver registro de errores".
