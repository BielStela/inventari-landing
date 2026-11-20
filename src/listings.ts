// Fake luxury real-estate listings, shown on hover over the built (yellow) dots
// of the map. Each built dot gets one, picked at random but stably (seeded by
// the dot's index), so a dot always shows the same listing. Photos: see
// src/listings/CREDITS.md.
import { rng } from './rng.ts'

const photos = import.meta.glob<string>('./listings/*.webp', { eager: true, import: 'default' })
const photo = (n: number) => photos[`./listings/${String(n).padStart(2, '0')}.webp`]

export type Listing = { lang: string; title: string; price: string; details: string; photo: string }

export const LISTINGS: Listing[] = [
  // Merely obscene.
  { lang: 'en', photo: photo(1), title: 'Luxury sea-view villa with infinity pool, summer rental', price: '$10,000,000 · July to August', details: '6 bedrooms · 8 bathrooms · 900 m²' },
  { lang: 'de', photo: photo(2), title: 'Pferdefinca mit Reitplatz, Stallungen und Gästehaus', price: '7.000.000 €', details: '12 ha · 8 Boxen · Pool' },
  { lang: 'en', photo: photo(3), title: 'Authentic finca with rustic soul, fully rebuilt, helipad', price: '12,500,000 €', details: '40 ha · 9 bedrooms · staff quarters' },
  { lang: 'de', photo: photo(4), title: 'Landsitz in absoluter Alleinlage, Blick bis zum Meer', price: 'Preis auf Anfrage', details: '300 ha · eigene Quelle · Weinberg' },
  { lang: 'sv', photo: photo(5), title: 'Herrgård från 1700-talet med olivlund och pool', price: '5 900 000 €', details: '4 ha · 7 sovrum' },
  { lang: 'en', photo: photo(6), title: 'Minimalist eco-villa with cinema and wine cellar', price: '8,400,000 €', details: '1,100 m² · 9 bedrooms · A+ energy rating' },
  { lang: 'de', photo: photo(7), title: 'Exklusive Neubauvilla im Naturschutzgebiet', price: '4.950.000 €', details: 'Baugenehmigung in Bearbeitung' },
  { lang: 'en', photo: photo(8), title: 'Harbour penthouse, 30 m yacht mooring included', price: '6,800,000 €', details: '4 bedrooms · roof terrace · jacuzzi' },
  { lang: 'es', photo: photo(9), title: 'Villa de lujo en primera línea de golf', price: '15.000.000 €', details: '3 piscinas · casa de invitados' },
  { lang: 'fr', photo: photo(10), title: 'Villa d’architecte sur la falaise, crique privée', price: '19 500 000 €', details: '5 chambres · ponton privé' },
  // Absurd.
  { lang: 'en', photo: photo(11), title: 'Saudi prince’s polo estate: 3 polo fields, 200 stables, falconry tower', price: '1,000,000,000 €', details: '600 ha · snow machines for winter polo' },
  { lang: 'de', photo: photo(12), title: 'Binnenland-Superyacht mit Hubschrauberlandeplatz, kein Meer nötig', price: '38.000.000 €', details: 'Liegeplatz: Stoppelfeld · 3 Kabinen' },
  { lang: 'en', photo: photo(13), title: 'Indoor beach with artificial waves, five minutes from the real beach', price: '64,000,000 €', details: '28 °C all year · hot-air balloon included' },
  { lang: 'de', photo: photo(14), title: 'Schottische Burg, Stein für Stein importiert und wieder aufgebaut', price: '47.000.000 €', details: '22 Schlafzimmer · Burggraben mit Meerwasser' },
  { lang: 'en', photo: photo(15), title: 'Doomsday bunker under a vineyard, with cinema and sushi bar', price: '33,000,000 €', details: '40 m deep · two years of rosé' },
  { lang: 'ru', photo: photo(16), title: 'Вилла с частным сафари-парком и жирафами', price: '77 000 000 €', details: '50 га · 6 жирафов · вертолётная площадка' },
  { lang: 'de', photo: photo(17), title: 'Private Skipiste mit Meerblick, ganzjährig befahrbar', price: '29.000.000 €', details: '420 m Abfahrt · Schlepplift · Après-Ski-Bar' },
  { lang: 'en', photo: photo(18), title: 'Finca with private runway and hangar for two jets', price: '120,000,000 €', details: '1,800 m runway · olive grove removed' },
  { lang: 'fr', photo: photo(19), title: 'Villa avec piscine à débordement et écurie de dromadaires', price: '26 000 000 €', details: 'Piste de course de chameaux · 8 chambres' },
  { lang: 'ca', photo: photo(20), title: 'Possessió del segle XVII amb heliport a la teulada', price: '18.500.000 €', details: 'Llicència en tràmit · 12 dormitoris' },
]

/** The listing of map dot i: random, but always the same for the same dot. */
export const listingFor = (i: number) => LISTINGS[Math.floor(rng(i + 1)() * LISTINGS.length)]
