Type: prototype
Status: resolved
Blocked by: 09

## Question

Welche freie Serifenschrift liefert die App für Gebetstext mit? Sie muss Latein, Kirchenslawisch (inkl. ѣ ѳ ѵ і ѡ ѧ ѫ ꙋ und Titlo) und polytonisches Griechisch abdecken, eine Lizenz zum Mitliefern haben (z. B. OFL) und Normal, Kursiv und Fett bieten. Kandidaten inklusive „Libron“ (Marks Wunsch) werden mit Beispieltexten nebeneinander gerendert; Mark entscheidet am Screenshot.

## Answer

**Noto Serif** (OFL 1.1), Mark am 5. Okt. 2026. Einzige geprüfte freie Serifenschrift ohne Lücken in Latein, Kirchenslawisch (inkl. Titlo und ⷭ) und polytonischem Griechisch; eine Schrift für alle Variant-Spalten. Libron hat kein Kyrillisch/Griechisch, keine freie Garamond ist vollständig. Noto Serif ist eine variable Schrift; falls GPUI Kursiv/Fett daraus nicht sauber erzeugt, werden statische Instanzen mit dem fontTools-Instancer gebaut. Details: [research/12-prayer-font.md](../research/12-prayer-font.md), Bilder unter `/mnt/project-files/gpui-rewrite/fonts/`.

