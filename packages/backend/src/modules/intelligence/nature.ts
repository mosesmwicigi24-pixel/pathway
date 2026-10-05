// Home's two photographs — the liturgy card and the Verse for Today — are
// nature, and they tell the hour and the season (owner, 2026-10-06, looking at
// a crowd of people under soap bubbles on the verse card at 01:42: "they
// reflect the hour, the time, the season … realistic … in the nature … now
// this is midnight, there must be something beautiful demonstrating midnight").
//
// Three rules, in this order:
//   1. The hour is the law. The picture keeps its own clock, set by Nairobi's
//      sun (it rises about 06:15 and sets about 18:30 all year), so midnight is
//      stars and moonlight, two in the afternoon is never a sunset, and half
//      past eight at night is night.
//   2. The season fits. Kenya's rains (March–May, October–December) never show
//      a dry golden savanna, and the dry months never show storm clouds. In
//      Advent, Christmas, Lent and Easter the church year's own pictures come
//      first whenever the hour has at least two of them.
//   3. The words come last. The verse card prefers a photograph of what the
//      verse names (stars, water, a mountain, light …), but only among the
//      photographs the hour and season already allow — so "a race" can never
//      again pull a daytime crowd onto a midnight card.
//
// Nature only: no people, crowds, buildings, vehicles or objects. Every photo
// below was looked at on contact sheets, not just tagged (2026-10-06): the old
// themed library's runners, crowd, astronaut, painted hands, wine glass and
// bread are gone, and so are the northern lights and snow, which no member in
// Nairobi will ever see from their door. Free Unsplash licence.
//
// The two cards never show the same photograph (each hour's list is split
// between them), the whole congregation sees the same picture in a given hour
// of a given day, and the picture changes every day.
import type { LiturgyArt, Season } from "./liturgy.js";
import { MOTIF_KEYWORDS } from "./imagery.js";

export type ArtHour = "deepnight" | "predawn" | "sunrise" | "morning" | "midday" | "afternoon" | "golden" | "sunset" | "nightfall";
export const ART_HOURS: readonly ArtHour[] = ["deepnight", "predawn", "sunrise", "morning", "midday", "afternoon", "golden", "sunset", "nightfall"];
export type Weather = "rains" | "dry";
type ChurchSeason = Exclude<Season, "ordinary">;

export interface NaturePhoto {
  id: string;
  alt: string;
  hours: readonly ArtHour[];
  /** Only shown in this weather season; absent = any time of year. */
  weather?: Weather;
  /** Preferred in these seasons of the church year. */
  church?: readonly ChurchSeason[];
  /** What the photograph shows, in MOTIF_KEYWORDS terms (verse matching). */
  motifs?: readonly string[];
}

export const photoUrl = (id: string): string => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1080&q=70`;

export const NATURE: readonly NaturePhoto[] = [
  // Deep night
  { id: "1419242902214-272b3f66ee7a", alt: "A shooting star across a violet sky", hours: ["deepnight"], church: ["advent", "christmas"], motifs: ["heavens"] },
  { id: "1435224668334-0f82ec57b605", alt: "A deep field of stars", hours: ["deepnight"], church: ["advent", "christmas"], motifs: ["heavens"] },
  { id: "1468186402854-9a641fd7a7c4", alt: "The Milky Way over a dark ridge", hours: ["deepnight"], church: ["christmas"], motifs: ["heavens"] },
  { id: "1475274047050-1d0c0975c63e", alt: "A night sky full of stars", hours: ["deepnight"], motifs: ["heavens", "water"] },
  { id: "1497024442048-0ac08ca91b00", alt: "Star trails turning over the mountain", hours: ["deepnight"], motifs: ["heavens", "mountain"] },
  { id: "1501418611786-e29f9929fe03", alt: "The moon breaking through night clouds", hours: ["deepnight", "nightfall"], motifs: ["heavens", "light"] },
  { id: "1502957291543-d85480254bf8", alt: "Stars over dark hills", hours: ["deepnight"], motifs: ["heavens"] },
  { id: "1508454340023-28b635bec171", alt: "Stars over a desert plain", hours: ["deepnight"], church: ["lent"], motifs: ["heavens"] },
  { id: "1516249181155-bbf89a130f77", alt: "Stars above a line of tall trees", hours: ["deepnight"], motifs: ["heavens"] },
  { id: "1527467779599-34448b3fa6a7", alt: "Stars without number", hours: ["deepnight"], motifs: ["heavens"] },
  { id: "1531992460473-db6b4335444d", alt: "The Milky Way over a mountain", hours: ["deepnight"], motifs: ["heavens", "mountain"] },
  { id: "1567712631541-12e7def8aa20", alt: "Stars above a dark mountain", hours: ["deepnight"], motifs: ["heavens", "mountain"] },
  { id: "1568405336404-1fefdca58699", alt: "Stars over the desert dunes", hours: ["deepnight"], church: ["christmas", "lent"], motifs: ["heavens"] },
  { id: "1575146240735-fd9fcac3326d", alt: "The Milky Way above a quiet lake", hours: ["deepnight"], motifs: ["heavens", "water"] },
  { id: "1595445364580-783c9deec51d", alt: "The Milky Way over a rock pinnacle", hours: ["deepnight"], motifs: ["heavens", "mountain"] },
  { id: "1597238147306-4298933940ba", alt: "Stars over the first glow of morning", hours: ["deepnight", "predawn"], church: ["advent"], motifs: ["heavens", "light"] },
  { id: "1600184436223-01227d1a5a58", alt: "The Milky Way in full", hours: ["deepnight"], church: ["advent", "christmas"], motifs: ["heavens"] },
  { id: "1607069945823-9173657fca71", alt: "The heart of the Milky Way", hours: ["deepnight"], church: ["advent", "christmas"], motifs: ["heavens"] },
  { id: "1620029288530-4ff6a684e33d", alt: "A rock tower under the stars", hours: ["deepnight"], church: ["lent"], motifs: ["heavens", "mountain"] },
  { id: "1630822957190-7e020791a7e0", alt: "The Milky Way rising over the hills", hours: ["deepnight"], church: ["advent", "christmas"], motifs: ["heavens"] },
  { id: "1641354113883-4a8304cb4608", alt: "The Milky Way over desert rocks", hours: ["deepnight"], church: ["lent"], motifs: ["heavens"] },
  { id: "1718376282770-2eefcdb8f7da", alt: "The night sky held in still water", hours: ["deepnight"], motifs: ["heavens", "water"] },
  { id: "1720293862142-bba219b0190e", alt: "The Milky Way above a forest lake", hours: ["deepnight"], motifs: ["heavens", "water"] },
  { id: "1720293862191-32c6a907a8ae", alt: "Stars between the clouds", hours: ["deepnight", "nightfall"], motifs: ["heavens"] },
  { id: "1758220465756-732719e08369", alt: "Moonlight on a rocky shore", hours: ["deepnight", "nightfall"], motifs: ["water", "light"] },
  { id: "1763084422467-231ec2c9348c", alt: "Stars over a misty lake", hours: ["deepnight", "predawn"], church: ["advent"], motifs: ["heavens", "water"] },
  { id: "1765209113187-20c28ff51fa8", alt: "A full moon behind the tall grass", hours: ["deepnight", "nightfall"], motifs: ["heavens", "light", "field"] },
  // Before dawn
  { id: "1456530308602-976f6a4bb440", alt: "Night settling over a misted mountain", hours: ["predawn", "nightfall"], motifs: ["heavens", "mountain"] },
  { id: "1498112943420-8eacc6e7cfc3", alt: "Dawn mist in the valleys", hours: ["predawn", "sunrise"], motifs: ["mountain"] },
  { id: "1504252060324-1c76e2e09939", alt: "Mist on the mountainside", hours: ["predawn"], weather: "rains", motifs: ["mountain"] },
  { id: "1508108712903-49b7ef9b1df8", alt: "Blue hills in the morning haze", hours: ["predawn", "morning"], motifs: ["mountain"] },
  { id: "1516026672322-bc52d61a55d5", alt: "An acacia beneath the dawn clouds", hours: ["predawn", "sunrise"], weather: "dry" },
  { id: "1635001360483-6772df57f2f9", alt: "Dawn blue over the mountains", hours: ["predawn"], motifs: ["mountain"] },
  { id: "1662802416326-454d8131b5cc", alt: "Blue fog in the forest before sunrise", hours: ["predawn"], weather: "rains" },
  { id: "1672917585946-339e22ac54dc", alt: "Layered hills before sunrise", hours: ["predawn"], church: ["advent"], motifs: ["mountain", "light"] },
  { id: "1675652202189-d33f7fa075f0", alt: "Mist lying in the valley", hours: ["predawn"], weather: "rains" },
  { id: "1678218718965-b6bd7b7c4dab", alt: "Dawn colour above the clouds", hours: ["predawn", "sunrise"], motifs: ["light"] },
  { id: "1786225524045-201cbd474b64", alt: "Fog over the dry plain before dawn", hours: ["predawn"], weather: "dry", church: ["lent"] },
  // Sunrise
  { id: "1444090542259-0af8fa96557e", alt: "Sunrise over a sea of cloud", hours: ["sunrise"], motifs: ["mountain", "light"] },
  { id: "1470252649378-9c29740c9fa8", alt: "Sunrise over the grass", hours: ["sunrise"], church: ["easter"], motifs: ["light", "field"] },
  { id: "1501164071995-0929702fd3ba", alt: "The sun rising behind a flat-topped acacia", hours: ["sunrise"], motifs: ["light"] },
  { id: "1511283878565-0833bf39de9d", alt: "Trees in the mist at sunrise", hours: ["sunrise"], motifs: ["light"] },
  { id: "1514241516423-6c0a5e031aa2", alt: "The sun rising over hazy ridges", hours: ["sunrise"], motifs: ["light", "mountain"] },
  { id: "1518729571365-9a891a9df2bd", alt: "The mountain above the clouds at daybreak", hours: ["sunrise"], motifs: ["mountain"] },
  { id: "1519414442781-fbd745c5b497", alt: "First rays over the valleys", hours: ["sunrise"], motifs: ["light"] },
  { id: "1533387520709-752d83de3630", alt: "A rose-coloured sunrise over the hills", hours: ["sunrise"], motifs: ["light"] },
  { id: "1547471080-7cc2caa01a7e", alt: "An acacia below the hills at sunrise", hours: ["sunrise"], motifs: ["mountain"] },
  { id: "1570844052008-bee926b7bc07", alt: "A great tree as the sun comes up", hours: ["sunrise"], motifs: ["light"] },
  { id: "1580687774725-4e23db308efc", alt: "Trees in the hazy savanna light", hours: ["sunrise", "golden"], motifs: ["light"] },
  { id: "1626348448069-9b156d20faeb", alt: "Sunrise over a field of flowers", hours: ["sunrise"], weather: "rains", church: ["easter"], motifs: ["field", "light"] },
  { id: "1653203201902-c103cd99531e", alt: "The sun lifting over a misty valley", hours: ["sunrise"], motifs: ["light"] },
  { id: "1655981650217-c091cd205970", alt: "Acacia branches in the morning sun", hours: ["sunrise"], motifs: ["light"] },
  { id: "1663790682196-926e224c50a7", alt: "A tree glowing in the orange dawn", hours: ["sunrise"], motifs: ["light"] },
  { id: "1665849863678-fc03a642a9aa", alt: "Morning sun over green, misted hills", hours: ["sunrise"], weather: "rains", motifs: ["light", "field"] },
  { id: "1667374071246-ac1d143830f3", alt: "The sun lifting beside an acacia", hours: ["sunrise"], motifs: ["light"] },
  { id: "1679639679185-146e2e6f7875", alt: "A tree and far hills in the dawn haze", hours: ["sunrise"], motifs: ["mountain"] },
  { id: "1730101703951-26b687cafcd0", alt: "Morning fog below the hills", hours: ["sunrise"], weather: "rains", motifs: ["mountain"] },
  { id: "1732106846688-3bac122e4f97", alt: "The sun behind a mountain at daybreak", hours: ["sunrise"], motifs: ["light", "mountain"] },
  { id: "1743309411498-a0f4f4b96b65", alt: "Morning fog filling the valley", hours: ["sunrise"], weather: "rains" },
  { id: "1760783320169-44e82cd3265f", alt: "A lone tree in the morning mist", hours: ["sunrise"], weather: "rains", motifs: ["field"] },
  { id: "1762689744940-8488691b0610", alt: "Early light across a green field", hours: ["sunrise"], motifs: ["field"] },
  { id: "1763887277852-be39663e9191", alt: "Horses grazing in the morning mist", hours: ["sunrise"], weather: "rains", motifs: ["field", "rest"] },
  { id: "1764618979735-dc750932d8a7", alt: "The sun over misty bushland", hours: ["sunrise"], weather: "rains", motifs: ["light"] },
  { id: "1766200064130-1da9bab345bf", alt: "Grazing in the first light", hours: ["sunrise"], motifs: ["field", "rest"] },
  { id: "1770843093638-1941ee5cbc64", alt: "Sunrise over the savanna", hours: ["sunrise"], church: ["easter"], motifs: ["light", "field"] },
  { id: "1774381498861-bb182e9de9d8", alt: "Grasses against the rising sun", hours: ["sunrise"], church: ["easter"], motifs: ["field"] },
  { id: "1775679226397-ac4366205c91", alt: "A quiet pasture at dawn", hours: ["sunrise"], motifs: ["rest"] },
  { id: "1775891842789-e6d8a48b1a91", alt: "Horses in the golden morning", hours: ["sunrise"], motifs: ["field"] },
  { id: "1776806399638-3f6693f8dcd4", alt: "Sunlight through the morning haze", hours: ["sunrise"], motifs: ["light"] },
  { id: "1783104122850-3991e530001a", alt: "Poppies opening in the morning sun", hours: ["sunrise"], weather: "rains", church: ["easter"], motifs: ["field"] },
  { id: "1783413193834-69b25f5949d9", alt: "Dew and mist on a meadow at sunrise", hours: ["sunrise"], weather: "rains", church: ["easter"], motifs: ["field"] },
  // Morning
  { id: "1425913397330-cf8af2ff40a1", alt: "Light falling through a tall forest", hours: ["morning"], weather: "rains", motifs: ["light"] },
  { id: "1441974231531-c6227db76b6e", alt: "A sunlit path through the forest", hours: ["morning"], weather: "rains", motifs: ["path", "light"] },
  { id: "1484557985045-edf25e08da73", alt: "A flock grazing in the field", hours: ["morning", "afternoon"], motifs: ["field", "rest", "shepherd"] },
  { id: "1489392191049-fc10c97e64b6", alt: "Kilimanjaro above the clouds", hours: ["morning"], motifs: ["mountain"] },
  { id: "1560603248-7a0649f99bed", alt: "Green highland farms", hours: ["morning"], weather: "rains", motifs: ["field"] },
  { id: "1604440095301-4ec2f9230155", alt: "Daisies above a mountain lake", hours: ["morning"], weather: "rains", church: ["easter"], motifs: ["field", "water"] },
  { id: "1610696022165-81e55501c9fa", alt: "A tall tree in the tea fields", hours: ["morning"], weather: "rains", motifs: ["field"] },
  { id: "1613061445510-e296bfedb73e", alt: "Kilimanjaro above the acacias", hours: ["morning"], motifs: ["mountain"] },
  { id: "1618856445394-259e67220916", alt: "Acacias by the water, a mountain beyond", hours: ["morning"], motifs: ["water", "mountain"] },
  { id: "1629905439673-86199719057a", alt: "A mountain lake in clear light", hours: ["morning", "midday", "afternoon"], motifs: ["water", "mountain"] },
  { id: "1630213036345-fec532de0806", alt: "Giraffes before the blue hills", hours: ["morning", "midday", "afternoon"], motifs: ["mountain"] },
  { id: "1631646109206-4b5616964f84", alt: "Zebras grazing below Kilimanjaro", hours: ["morning", "afternoon"], motifs: ["mountain", "field"] },
  { id: "1631646109248-a7264aae1790", alt: "A giraffe beneath Kilimanjaro", hours: ["morning"], motifs: ["mountain"] },
  { id: "1637219415325-3b940e262dd3", alt: "A path into the misty forest", hours: ["morning"], weather: "rains", motifs: ["path"] },
  { id: "1646159755791-54e741749028", alt: "Mount Kenya's peak in the clouds", hours: ["morning", "midday"], motifs: ["mountain"] },
  { id: "1650442940325-7f57848ffb9c", alt: "A still lake in the morning sun", hours: ["morning"], motifs: ["water"] },
  { id: "1658823201544-c38e58685942", alt: "Moorland flowers below the peaks", hours: ["morning"], weather: "rains", church: ["easter"], motifs: ["field", "mountain"] },
  { id: "1669557673726-293309494c20", alt: "Acacias on the green plain", hours: ["morning"], weather: "rains", motifs: ["field"] },
  { id: "1703874567931-ab49447588cd", alt: "Giraffes among the acacias", hours: ["morning", "afternoon"], motifs: ["mountain"] },
  { id: "1705188379892-5de7e5d51fd2", alt: "A lake seen through the branches", hours: ["morning"], motifs: ["water"] },
  { id: "1709842387288-bcebd36ce629", alt: "Green grass after the rains", hours: ["morning"], weather: "rains", church: ["easter"], motifs: ["field"] },
  { id: "1717683822555-06409656b1bd", alt: "Wildflowers in the sun", hours: ["morning"], weather: "rains", church: ["easter"], motifs: ["field"] },
  { id: "1717683822568-3b85cb0b2844", alt: "Wildflowers reaching for the light", hours: ["morning"], weather: "rains", church: ["easter"], motifs: ["field"] },
  { id: "1735637082450-deeffc9fbc2a", alt: "An acacia and the mountain beyond", hours: ["morning", "afternoon"], motifs: ["mountain"] },
  { id: "1744932126743-8954e1432a5a", alt: "A sunny clearing in the forest", hours: ["morning"], weather: "rains", motifs: ["field", "rest"] },
  { id: "1756213993188-183953d397e3", alt: "Hazy hills over the forest", hours: ["morning"], motifs: ["mountain"] },
  // Midday
  { id: "1445264718234-a623be589d37", alt: "Under a canopy of green", hours: ["midday"], weather: "rains", motifs: ["rest"] },
  { id: "1468581264429-2548ef9eb732", alt: "A calm sea to the horizon", hours: ["midday", "afternoon"], motifs: ["water"] },
  { id: "1505118380757-91f5f5632de0", alt: "White surf on a turquoise sea", hours: ["midday"], motifs: ["water", "storm"] },
  { id: "1505142468610-359e7d316be0", alt: "A wave breaking on the sand, from above", hours: ["midday"], motifs: ["water"] },
  { id: "1506953823976-52e1fdc0149a", alt: "A palm leaning over the shore", hours: ["midday"], motifs: ["water"] },
  { id: "1535338881181-3646e5ab2ee2", alt: "Green hills of the Rift", hours: ["midday"], weather: "rains", motifs: ["mountain"] },
  { id: "1535342604578-a175d3fc4f22", alt: "Dry hills in the midday sun", hours: ["midday", "afternoon"], weather: "dry", church: ["lent"], motifs: ["mountain"] },
  { id: "1535940360221-641a69c43bac", alt: "Acacias across the golden savanna", hours: ["midday", "afternoon"], weather: "dry", motifs: ["field"] },
  { id: "1586359716568-3e1907e4cf9f", alt: "Palms along a quiet shore", hours: ["midday"], motifs: ["water", "rest"] },
  { id: "1623876355063-15d1d5e5b89b", alt: "Waves on a white beach", hours: ["midday"], motifs: ["water"] },
  { id: "1636636985438-4154b379aac5", alt: "The Great Rift Valley under white clouds", hours: ["midday", "afternoon"], motifs: ["mountain"] },
  { id: "1651754164251-27e7017c8ede", alt: "A waterfall in the forest", hours: ["midday"], weather: "rains", motifs: ["water"] },
  { id: "1667935837291-1dc178866251", alt: "The coast at midday", hours: ["midday"], motifs: ["water"] },
  { id: "1701906268617-e56feaedfdb6", alt: "A turquoise lake under the mountains", hours: ["midday"], motifs: ["water", "mountain"] },
  { id: "1709486851809-ca174bfed7ed", alt: "White sand and turquoise water", hours: ["midday"], motifs: ["water"] },
  { id: "1714544047757-89462703581e", alt: "A green meadow under white clouds", hours: ["midday"], weather: "rains", motifs: ["field"] },
  { id: "1714544566545-96da265563df", alt: "A green meadow after rain", hours: ["midday"], weather: "rains", motifs: ["field", "water"] },
  { id: "1717683823239-2ad7891c0ee4", alt: "A bank of wildflowers", hours: ["midday", "afternoon"], motifs: ["field"] },
  { id: "1723767625670-a6c509338c22", alt: "Forested hills under a blue sky", hours: ["midday", "afternoon"], motifs: ["mountain"] },
  { id: "1734454736580-23f19bdf6423", alt: "A lake held between mountains", hours: ["midday", "afternoon"], motifs: ["water", "mountain"] },
  { id: "1770959837753-63e67740c99d", alt: "Yellow wildflowers under a blue sky", hours: ["midday", "afternoon"], motifs: ["field"] },
  { id: "1778099744694-b29acc79927b", alt: "Reeds at the edge of a lake", hours: ["midday", "afternoon"], motifs: ["water"] },
  { id: "1781036150366-3854152f37db", alt: "Palms on a small island", hours: ["midday"], motifs: ["water"] },
  { id: "1783883614310-18b4ffdf9df1", alt: "A clear emerald lake below the peaks", hours: ["midday"], motifs: ["water", "mountain"] },
  // Afternoon
  { id: "1535078016039-9c10b96ba218", alt: "An acacia in the dry grass", hours: ["afternoon"], weather: "dry", motifs: ["field"] },
  { id: "1589659647268-7803091f717b", alt: "A rain shower crossing the savanna", hours: ["afternoon"], weather: "rains", motifs: ["storm"] },
  { id: "1669196741160-8fc1c0ca925b", alt: "Terraced hills and red earth", hours: ["afternoon"], weather: "rains", motifs: ["field"] },
  { id: "1685301093591-1203b0b15eae", alt: "A lone tree under a gathering storm", hours: ["afternoon"], weather: "rains", motifs: ["storm"] },
  { id: "1738508370941-6b333ae8a3dc", alt: "A green meadow in afternoon light", hours: ["afternoon"], weather: "rains", motifs: ["field"] },
  { id: "1759363199657-9bfac6fca7dc", alt: "Afternoon sun on a wide lake", hours: ["afternoon"], motifs: ["water"] },
  { id: "1761204676901-2c751d77bd80", alt: "Green fields and trees", hours: ["afternoon"], weather: "rains", motifs: ["field"] },
  { id: "1771790004575-85a257e8da80", alt: "Rain clouds over the plain", hours: ["afternoon"], weather: "rains", motifs: ["storm"] },
  { id: "1771790027873-d0b62f951af8", alt: "A lone acacia under a grey sky", hours: ["afternoon"], weather: "rains", motifs: ["storm"] },
  { id: "1775566981662-9b18f0eb8651", alt: "A meadow at the edge of the woods", hours: ["afternoon"], motifs: ["field"] },
  { id: "1782092323103-862e70d6657e", alt: "Tall grasses against the sky", hours: ["afternoon"], motifs: ["field"] },
  { id: "1783012114219-6a42c5a4bfb3", alt: "Heavy rain sweeping the land", hours: ["afternoon"], weather: "rains", motifs: ["storm"] },
  { id: "1784982850372-03f17ba945d8", alt: "Storm clouds over the mountain", hours: ["afternoon"], weather: "rains", motifs: ["storm", "mountain"] },
  // Golden hour
  { id: "1433477077279-9354d2d72f6b", alt: "Evening sun over a rocky valley", hours: ["golden"], church: ["lent"], motifs: ["mountain", "light"] },
  { id: "1500382017468-9049fed747ef", alt: "Wheat in the evening sun", hours: ["golden"], weather: "dry", motifs: ["field"] },
  { id: "1518098268026-4e89f1a2cd8e", alt: "Rolling hills in the evening light", hours: ["golden"], motifs: ["field", "rest"] },
  { id: "1585215148712-c6505c99c392", alt: "Golden light on the valley", hours: ["golden"], motifs: ["mountain"] },
  { id: "1592807395931-96660801cf55", alt: "A tree in the field at evening", hours: ["golden"], motifs: ["field"] },
  { id: "1604223190546-a43e4c7f29d7", alt: "Mountains in late golden light", hours: ["golden"], motifs: ["mountain"] },
  { id: "1612676239016-41e2c92b8e06", alt: "Evening haze over the hills", hours: ["golden"], motifs: ["mountain"] },
  { id: "1616632718653-10cde51dbbeb", alt: "Dry grass glowing at evening", hours: ["golden"], weather: "dry", motifs: ["field"] },
  { id: "1618661733134-6a750e4aa08a", alt: "Rays through the trees in the evening", hours: ["golden"], motifs: ["light"] },
  { id: "1621139261252-27d1a67449f4", alt: "Acacias and antelope at evening", hours: ["golden"], motifs: ["field"] },
  { id: "1650357519740-c888919621f8", alt: "The low sun behind the trees", hours: ["golden"], motifs: ["light", "field"] },
  { id: "1655397364584-df9fa43a8f6a", alt: "A hazy evening over the mountain", hours: ["golden"], motifs: ["mountain"] },
  { id: "1691655369772-63b9f615618b", alt: "A lone acacia below the mountains", hours: ["golden"], motifs: ["mountain"] },
  { id: "1721172195811-bb704b18842d", alt: "The sun lowering over the ridges", hours: ["golden"], motifs: ["mountain"] },
  { id: "1756909358952-7e90a62b8319", alt: "Zebras walking home at evening", hours: ["golden"], motifs: ["field"] },
  { id: "1779925770412-0a9bdcb38e3a", alt: "Storm clouds over a waterhole", hours: ["golden"], weather: "rains", motifs: ["storm", "water"] },
  { id: "1781728323345-da2866c32b6b", alt: "A giraffe in the golden light", hours: ["golden"] },
  { id: "1781728323719-ab6ff8417e0d", alt: "Golden light across the field", hours: ["golden"], motifs: ["field", "light"] },
  { id: "1786982997870-f62356ccc664", alt: "Zebras grazing in the low sun", hours: ["golden"], motifs: ["field"] },
  // Sunset
  { id: "1475924156734-496f6cac6ec1", alt: "Evening light on the shore", hours: ["sunset"], motifs: ["water", "light"] },
  { id: "1494548162494-384bba4ab999", alt: "The sun going down behind the hills", hours: ["sunset"], motifs: ["mountain", "light"] },
  { id: "1500534623283-312aade485b7", alt: "The last sun over the ridges", hours: ["sunset"], motifs: ["mountain"] },
  { id: "1503803548695-c2a7b4a5b875", alt: "Sunset over the sea", hours: ["sunset"], motifs: ["water"] },
  { id: "1506880648420-aafaa650d147", alt: "The sun setting into the mountains", hours: ["sunset"], motifs: ["mountain"] },
  { id: "1510784722466-f2aa9c52fff6", alt: "Sunset through bare branches", hours: ["sunset"], motifs: ["light"] },
  { id: "1571040514537-0424f4a4ee1e", alt: "Waves under a dusk sky", hours: ["sunset", "nightfall"], motifs: ["water"] },
  { id: "1581224463294-908316338239", alt: "A hazy sunset over the water", hours: ["sunset"], motifs: ["water"] },
  { id: "1595652973888-c5677816f6f4", alt: "Trees under a rose and violet sky", hours: ["sunset", "nightfall"] },
  { id: "1595652974457-41fb7941a65f", alt: "The sun setting over the savanna", hours: ["sunset"], motifs: ["field"] },
  { id: "1602685234860-3d38ee425ae8", alt: "Acacias against the burning sky", hours: ["sunset"] },
  { id: "1606614472842-c1e97a5be9f7", alt: "Sunset clouds over the water", hours: ["sunset"], motifs: ["water"] },
  { id: "1606614473135-83efb3b4c026", alt: "Still water under a cloudy sunset", hours: ["sunset"], motifs: ["water"] },
  { id: "1607947242748-a1a4d4b72022", alt: "A red sky over the sea", hours: ["sunset"], motifs: ["water"] },
  { id: "1613365891889-7f7e3316be61", alt: "Storm clouds over a sunset sea", hours: ["sunset"], weather: "rains", motifs: ["water", "storm"] },
  { id: "1615144092078-aecc315dfe0c", alt: "Clouds lit by the setting sun", hours: ["sunset"], motifs: ["light"] },
  { id: "1616036740257-9449ea1f6605", alt: "A fiery sun on the waves", hours: ["sunset"], motifs: ["water"] },
  { id: "1622993288089-18298ec89b78", alt: "The setting sun's rays over the mountains", hours: ["sunset"], motifs: ["mountain", "light"] },
  { id: "1623743423143-23df3234ae5c", alt: "Trees and the setting sun", hours: ["sunset"], motifs: ["light"] },
  { id: "1636871694216-d04517e0d1c2", alt: "The sun going down over desert hills", hours: ["sunset"], weather: "dry", church: ["lent"], motifs: ["mountain"] },
  { id: "1642741974974-37cafd8fc3bf", alt: "The red sun over the water", hours: ["sunset"], motifs: ["water", "light"] },
  { id: "1648706903501-8b74096438df", alt: "Dusk settling on the coast", hours: ["sunset", "nightfall"], motifs: ["water"] },
  { id: "1648885533514-1ed16479bdd7", alt: "Golden light on the shore", hours: ["sunset"], motifs: ["water"] },
  { id: "1650936374671-6d6f95c0bbb7", alt: "Elephants before the sunset", hours: ["sunset"] },
  { id: "1654362248566-6804dbcc5bdc", alt: "Ridges in the last light", hours: ["sunset"], motifs: ["mountain"] },
  { id: "1659608300525-a71e30dd2420", alt: "The sun touching the hills", hours: ["sunset"], motifs: ["light"] },
  { id: "1668468834614-b9fd661a0433", alt: "Hills at sunset", hours: ["sunset"], motifs: ["mountain"] },
  { id: "1682999959985-66f1a4875740", alt: "Waves catching the sunset", hours: ["sunset"], motifs: ["water"] },
  { id: "1718880988830-f3e641077cb4", alt: "A bare tree against the setting sun", hours: ["sunset"], motifs: ["light"] },
  { id: "1723251679023-9fc478009dbb", alt: "The sun setting over the forest", hours: ["sunset"], motifs: ["light"] },
  { id: "1728042107033-76b13feac547", alt: "Giraffes beneath an acacia at sunset", hours: ["sunset"] },
  { id: "1743084987332-8394a2e8b383", alt: "A tree against a blazing sky", hours: ["sunset"], motifs: ["light"] },
  { id: "1751813243026-e5eb5043286d", alt: "The red sun going down", hours: ["sunset"], motifs: ["light"] },
  { id: "1756475471671-48813cf5ea5b", alt: "An acacia against an African sunset", hours: ["sunset"] },
  { id: "1758867022060-230aba0aee2d", alt: "An acacia against the afterglow", hours: ["sunset"] },
  { id: "1760199025448-38e2a6f7a9cf", alt: "Trees against a warm sunset", hours: ["sunset"] },
  { id: "1760199025806-178119c5d5f9", alt: "Trees against the dusk", hours: ["sunset", "nightfall"] },
  { id: "1760199078320-18976d421338", alt: "A baobab against the evening sky", hours: ["sunset", "nightfall"], motifs: ["rest"] },
  { id: "1761078206756-68d3023f3021", alt: "Sunset over the dry savanna", hours: ["sunset"], weather: "dry", motifs: ["field"] },
  { id: "1768050854212-2a9e0dca8066", alt: "A bare tree against the orange sky", hours: ["sunset"], church: ["lent"] },
  { id: "1769984465162-27187cf139dd", alt: "The sun setting over a dark forest", hours: ["sunset"] },
  { id: "1775135505566-865dcb6f37aa", alt: "Trees against a pink sunset", hours: ["sunset"] },
  { id: "1782070584433-1f75fbe90aca", alt: "Elephants against the setting sun", hours: ["sunset"] },
  { id: "1783679602881-c79e433f5964", alt: "A fiery sunset over the treeline", hours: ["sunset"], motifs: ["light"] },
  { id: "1788422230370-289e1621644b", alt: "Trees against an orange sky", hours: ["sunset"] },
  // Nightfall
  { id: "1475738972911-5b44ce984c42", alt: "Embers of a fire glowing in the dark", hours: ["nightfall"], motifs: ["fire"] },
  { id: "1519614218660-ea0a24a43b4c", alt: "Hills fading into the dusk", hours: ["nightfall"], motifs: ["mountain"] },
  { id: "1544961730-ec9b1220a960", alt: "A palm under the first stars", hours: ["nightfall"], motifs: ["heavens"] },
  { id: "1563658082190-a0052b540360", alt: "A lone tree under the night sky", hours: ["nightfall"], motifs: ["heavens", "rest"] },
  { id: "1595520519880-a86c48ea536c", alt: "Blue night clouds over the mountains", hours: ["nightfall"], motifs: ["heavens", "mountain"] },
  { id: "1621472126228-d20f26ff6aee", alt: "Waves in the blue of dusk", hours: ["nightfall"], motifs: ["water"] },
  { id: "1626663082558-31972acf4763", alt: "Stars appearing over a dusk shore", hours: ["nightfall"], motifs: ["heavens", "water"] },
  { id: "1632168704789-8d4c9443efc0", alt: "A full moon rising over the lake", hours: ["nightfall"], motifs: ["heavens", "water", "light"] },
  { id: "1634712900135-a35a63b14974", alt: "The last light over the hills", hours: ["nightfall"], motifs: ["mountain"] },
  { id: "1658327825922-c7e6b71170f6", alt: "A tree and stars beside the lake", hours: ["nightfall"], motifs: ["heavens", "water", "light"] },
  { id: "1713972753297-9eaebc1d7b24", alt: "The moon rising behind the trees", hours: ["nightfall"], motifs: ["heavens", "light"] },
  { id: "1718376282529-9591bbde9d24", alt: "Night over a still lake", hours: ["nightfall"], motifs: ["heavens", "water"] },
  { id: "1760199025541-63bc2c3a7754", alt: "A tree against the twilight", hours: ["nightfall"] },
  { id: "1767991836279-63358ac05f51", alt: "The moon over a forested cliff", hours: ["nightfall"], motifs: ["heavens", "mountain"] },
  { id: "1775457114788-1be3033549e6", alt: "The moon over the treetops at dusk", hours: ["nightfall"], motifs: ["heavens"] },
  { id: "1776795226411-deb88431deb2", alt: "A half moon in the evening sky", hours: ["nightfall"], motifs: ["heavens", "light"] },
  { id: "1779960595210-0e1c23991175", alt: "A full moon over the dry hills", hours: ["nightfall"], weather: "dry", motifs: ["heavens", "light"] },
  { id: "1788461404538-49f5e95cddf3", alt: "A golden moon above the mountain", hours: ["nightfall"], motifs: ["heavens", "mountain", "light"] },
];

const EAT_MS = 3 * 3600_000;
const DAY_MS = 24 * 3600_000;
const eat = (now: Date): Date => new Date(now.getTime() + EAT_MS);

/** The picture's clock: Nairobi local time against Nairobi's sun. */
export function artHourOf(now: Date = new Date()): ArtHour {
  const t = eat(now);
  const m = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (m < 5 * 60) return "deepnight";
  if (m < 6 * 60 + 15) return "predawn";
  if (m < 8 * 60 + 30) return "sunrise";
  if (m < 12 * 60) return "morning";
  if (m < 14 * 60 + 30) return "midday";
  if (m < 17 * 60) return "afternoon";
  if (m < 18 * 60 + 15) return "golden";
  if (m < 19 * 60 + 15) return "sunset";
  return "nightfall";
}

/** Kenya's two rains (long: March–May, short: October–December); dry otherwise. */
export function weatherOf(now: Date = new Date()): Weather {
  const month = eat(now).getUTCMonth() + 1;
  return (month >= 3 && month <= 5) || month >= 10 ? "rains" : "dry";
}

const HOUR_OFFSET: Record<ArtHour, number> = {
  deepnight: 0, predawn: 3, sunrise: 6, morning: 9, midday: 12, afternoon: 15, golden: 18, sunset: 21, nightfall: 24,
};

/** One card's share of the photographs that fit this hour and weather —
 *  the liturgy card takes the even places, the verse card the odd, so the
 *  two can never coincide. Sorted by id, so it is stable within a season. */
export function cardPool(card: "liturgy" | "verse", hour: ArtHour, weather: Weather): NaturePhoto[] {
  const fits = NATURE.filter((p) => p.hours.includes(hour) && (!p.weather || p.weather === weather))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return fits.filter((_, i) => (i % 2 === 0) === (card === "liturgy"));
}

function names(text: string, motif: string): boolean {
  const low = ` ${text.toLowerCase().replace(/[^a-z\s]/g, " ")} `;
  return (MOTIF_KEYWORDS[motif] ?? []).some((kw) => low.includes(` ${kw} `));
}

/**
 * Today's photograph for a card at this hour: the hour first, then the season,
 * then (verse card) the verse's own words. Deterministic per (card, hour, day).
 */
export function natureArt(
  card: "liturgy" | "verse",
  now: Date,
  opts: { season: Season; text?: string | null },
): LiturgyArt {
  const hour = artHourOf(now);
  const pool = cardPool(card, hour, weatherOf(now));
  let tier = pool;
  if (opts.season !== "ordinary") {
    const church = pool.filter((p) => p.church?.includes(opts.season as ChurchSeason));
    if (church.length >= 2) tier = church;
  }
  if (card === "verse" && opts.text) {
    const text = opts.text;
    const worded = tier.filter((p) => (p.motifs ?? []).some((m) => names(text, m)));
    if (worded.length > 0) tier = worded;
  }
  const day = Math.floor((eat(now).getTime()) / DAY_MS);
  const photo = tier[(((day + HOUR_OFFSET[hour]) % tier.length) + tier.length) % tier.length]!;
  return { url: photoUrl(photo.id), alt: photo.alt };
}
