-- What's in Your Hand?: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'whats-in-your-hand');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Ephesians 4:7–8', 'The Giver Has Already Given'),
  (2, 'Exodus 4:2', 'What Is That in Your Hand?'),
  (3, '2 Timothy 1:6', 'Gifts, Skills and Graces'),
  (4, 'Proverbs 18:16', 'Your Gift Will Make Room for You'),
  (5, '2 Timothy 1:6–7', 'Fan It Into Flame'),
  (6, 'John 6:9', 'Five Loaves in the Right Hands'),
  (7, 'Exodus 31:2–4', 'Bezalel: When Craftsmanship Is Calling'),
  (8, '1 Peter 4:10', 'Gifts Are Discovered Serving'),
  (9, 'Matthew 25:24–25', 'The Peril of the Buried Talent'),
  (10, '1 Corinthians 12:7', 'Gifted for Your Generation')
) AS v(n, ref, title) WHERE p.code = 'whats-in-your-hand';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'whats-in-your-hand'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Ephesians 4:7–8', $dev$“But to each one of us grace has been given as Christ apportioned it. This is why it says: “When he ascended on high, he took many captives and gave gifts to his people.””$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Begin with the settled fact: the ascended Christ gave gifts to his people — and “each one of us” received as He apportioned. Gifting in the kingdom is not a lottery some lost; it is an inheritance every child holds.

This matters because many believers relate to gifting from a posture of lack: everyone else got something. Hear the verse again — to each one. The question of this plan is never whether you were gifted, but what, and where it is hiding under familiarity.

Familiar gifts disguise themselves as “nothing special” — the thing you do easily, you assume everyone does easily. They do not. So begin with faith’s inventory posture: Lord, You gave; help me find where I put it.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What do you do so easily you assumed “everyone” can do it?

— What have others repeatedly noticed in you that you dismissed?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Ascended Lord, You gave gifts to Your people and You did not skip me. Open my eyes to what You apportioned — especially what familiarity has hidden. Amen.

_May you discover this week a treasure you have been carrying all along._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 4:7–13; 1 Corinthians 12:4–7$dev$),

  (2, 1, 'scripture', 'Today''s Reading', 'Exodus 4:2', $dev$“Then the Lord said to him, “What is that in your hand?” “A staff,” he replied.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Moses had just listed his deficits — who am I? what shall I say? they won’t believe me — and God answered the inventory of lack with an inventory of possession: what is that in your hand?

A staff. Wood. The most ordinary object in a shepherd’s world — and in God’s hands, the instrument of plagues, sea-partings and water from rock. Notice the sequence: Moses had to throw it down (surrender it) before it revealed its power, and take it up again by God’s command as “the staff of God” (Exodus 4:20). Same wood, new ownership.

Your staff is whatever is already in your hand: a skill, a kitchen, a lorry, a laptop, a voice, a small shop, a network. Heaven’s question is not “what do you lack?” — it never has been. Throw down what you carry, receive it back as God’s, and watch what ordinary wood can do.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Name honestly what is already “in your hand” — list five ordinary things.

— Which one is God asking you to throw down and receive back as His?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, here is my staff — the ordinary things I carry. I throw them down; own them fully; hand them back anointed. Use my wood for Your wonders. Amen.

_May everything ordinary in your hands become extraordinary in His._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Exodus 4:1–20; John 6:8–13$dev$),

  (3, 1, 'scripture', 'Today''s Reading', '2 Timothy 1:6', $dev$“Paul tells Timothy: For this reason I remind you to fan into flame the gift of God, which is in you through the laying on of my hands.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$It helps to sort your equipment, because it grows in three ways. Gifts are issued — capacities woven into you from birth and by the Spirit: the born encourager, the natural leader, the intercessor, the maker. Skills are farmed — abilities acquired by learning and repetition: the trade, the craft, the languages, the spreadsheets. Graces are imparted — like Timothy’s gift “through the laying on of hands,” received in the house of God, activated by faith.

Confusing the categories causes grief: people wait passively for skills (which must be farmed) and strive anxiously for gifts (which must simply be discovered and fanned).

So make three columns today and take inventory: what was I issued? what have I farmed? what has God imparted along the way? Clarity about what you carry is the first act of stewardship.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Fill the three columns: issued, farmed, imparted — what goes where?

— Which column have you neglected, and what would attention look like?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, give me an accurate inventory — the issued, the farmed, the imparted. I receive each with thanks, and I take up stewardship of all three. Amen.

_May your three columns fill up with more than you expected to find._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$2 Timothy 1:6–7; Exodus 31:1–6$dev$),

  (4, 1, 'scripture', 'Today''s Reading', 'Proverbs 18:16', $dev$“A gift opens the way and ushers the giver into the presence of the great.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Here is a promise to retire your elbowing: a gift opens the way — it makes room for its carrier and ushers him before the great. Doors that connections cannot open and money cannot bribe swing wide for a gift in operation.

Watch it in Scripture: David’s harp skill carried a shepherd into a king’s court before his sword ever did. Joseph’s interpreting lifted him from dungeon to palace between morning and noon. Daniel’s excellence set a captive over an empire’s administrators. None of them networked their way up; their gifts were their escorts.

The practical wisdom: invest in the gift, not in the pushing. Sharpen it until it speaks for itself, serve with it wherever you stand, and let it do its ancient work. Rooms you cannot imagine are already scheduled to be opened by what is in your hands.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you been elbowing where you should be sharpening?

— What would a season of deliberate gift-sharpening look like?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, I retire from pushing and I report to sharpening. Let my gift be my escort — and every room it opens, let me enter carrying Your name. Amen.

_May your gift quietly book rooms your résumé could never enter._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 18:16; 1 Samuel 16:14–23$dev$),

  (5, 1, 'scripture', 'Today''s Reading', '2 Timothy 1:6–7', $dev$“For this reason I remind you to fan into flame the gift of God… For the Spirit God gave us does not make us timid, but gives us power, love and self-discipline.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Timothy’s gift was real, imparted and confirmed — and apparently dimming. Paul’s remedy tells us something crucial: gifts are given as embers, not bonfires. Fan into flame — your active, continual breath is part of the design.

How does one fan? Use — gifts grow only in operation, never in storage. Study — the gifted who also train become the excellent. Company — embers bundled together blaze; isolated coals cool. And courage — notice Paul immediately addresses timidity, because fear is the great smotherer of gifts. Many flames have died under the wet blanket of “who am I to…?”

The Spirit in you is not timid — power, love, self-discipline. So identify your dimmed ember today and administer oxygen: one use, one study, one bold yes.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Which gift of yours has dimmed from ember toward ash?

— What is this week’s oxygen: one use, one study, one yes?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Holy Spirit, breathe with me on the embers. I renounce the timidity that smothered my gift, and I fan it into flame — with use, with learning, with courage. Amen.

_May every dimmed ember in you roar back into holy flame._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$2 Timothy 1:3–7; 1 Timothy 4:14–15$dev$),

  (6, 1, 'scripture', 'Today''s Reading', 'John 6:9', $dev$““Here is a boy with five small barley loaves and two small fish, but how far will they go among so many?””$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Andrew’s arithmetic was honest: five loaves, two fish, five thousand men — how far will they go? Every gift-carrier knows that arithmetic. My little skill, my small voice, my one talent — against needs this size?

But the boy did the one thing arithmetic cannot argue with: he put what he had into the hands of Jesus. And in those hands, small stopped being small. Everyone ate; twelve baskets remained; and a boy’s lunch entered eternal Scripture.

The lesson is not that your gift is bigger than you think (though it is). The lesson is that placement outranks size. Five loaves kept are five loaves; five loaves surrendered are a feeding. Stop measuring your offering against the crowd. Measure the Hands you are placing it in — then place it, daily, and let Him do the mathematics of multiplication.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— What “small lunch” have you been withholding because of the crowd’s size?

— What does placing it in His hands look like — concretely, this week?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, here is my lunch — small by every count but Yours. I place it in Your hands. Do Your mathematics, and let multitudes eat from what I almost kept. Amen.

_May your smallness, surrendered, out-feed every bigness that was kept._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$John 6:1–13; 2 Kings 4:1–7$dev$),

  (7, 1, 'scripture', 'Today''s Reading', 'Exodus 31:2–4', $dev$“See, I have chosen Bezalel… and I have filled him with the Spirit of God, with wisdom, with understanding, with knowledge and with all kinds of skills — to make artistic designs…”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$The first person Scripture describes as “filled with the Spirit of God” was not a prophet or a priest. He was a craftsman — Bezalel, filled for metalwork, stonework, woodwork and design. Heaven anoints hands, not only pulpits.

This demolishes the wall many carry between “sacred” gifts and “secular” ones. The accountant’s precision, the builder’s eye, the farmer’s patience, the coder’s logic, the cook’s hospitality — when consecrated, these are Bezalel gifts: the Spirit’s workmanship flowing through workmanship.

So stop waiting to feel “spiritual” before you count your abilities as calling. Whatever your hands do with excellence can be filled with the Spirit and aimed at the building of God’s purposes. The sanctuary needed preachers less than it needed one anointed craftsman — and your generation’s sanctuaries are no different.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Which of your “secular” abilities might be a Bezalel gift awaiting consecration?

— What would it mean to do your craft “filled with the Spirit” this week?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Spirit of God, fill my hands the way You filled Bezalel’s. I consecrate my craft — every skill, every design, every day’s work — to the building of Your purposes. Amen.

_May your workmanship carry the unmistakable fingerprints of the Spirit._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Exodus 31:1–11; 35:30–35$dev$),

  (8, 1, 'scripture', 'Today''s Reading', '1 Peter 4:10', $dev$“Each of you should use whatever gift you have received to serve others, as faithful stewards of God’s grace in its various forms.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Here is why some people cannot find their gifts: they are searching in contemplation what is only revealed in motion. Gifts are like muscles — invisible on the couch, unmistakable under load. Peter’s instruction assumes it: use what you have received to serve others.

Service is heaven’s gift-detection laboratory. Volunteer broadly and watch three gauges: what energizes you while it exhausts others; what draws sincere thanks you did not fish for; what produces disproportionate fruit for your effort. Where all three point, a gift is surfacing.

Notice also Peter’s job title for you: steward of God’s grace in its various forms. The gift is God’s property in your management — which ends both pride (it was received) and neglect (it will be accounted for). So get under load this month. Your gifts are waiting in the serving.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Where can you volunteer this month, broadly enough to test the gauges?

— What has already energized you, drawn thanks, and borne easy fruit?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, I enter the laboratory of service. Put me under load, read the gauges with me, and surface the gifts You stored for the serving of Your people. Amen.

_May service reveal in you what a decade of self-searching never could._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$1 Peter 4:8–11; Romans 12:4–8$dev$),

  (9, 1, 'scripture', 'Today''s Reading', 'Matthew 25:24–25', $dev$““Master,” he said, “I knew that you are a hard man… so I was afraid and went out and hid your gold in the ground.””$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$The servant with one talent did not squander it, steal it or lose it. He buried it — and returned it intact, expecting commendation for safety. Instead he heard the parable’s hardest words. In the kingdom’s accounting, unused is not neutral; preservation without deployment is loss.

Read his motive carefully, for it lives in many of us: I was afraid. Fear of failing, fear of judgment, fear of comparison with the five-talent men — and fear, note well, rooted in a false picture of the master as harsh. The lie about God’s character produced the paralysis of God’s gift.

But you know better now — fifteen days ago you rebuilt that picture. Your Master multiplies joy to faithful risk-takers: “Come and share your master’s happiness!” So hold a small exhumation today: name the buried talent, name the fear that buried it, and put a spade in the ground.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— What talent have you buried — and which fear held the spade?

— What false picture of God made the burial feel safe?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Master of joy, I dig up what fear buried. Correct my picture of You, and receive my talent back into trade — I would rather risk with You than rust without You. Amen.

_May everything fear ever buried in you come up out of the ground this week._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 25:14–30$dev$),

  (10, 1, 'scripture', 'Today''s Reading', '1 Corinthians 12:7', $dev$“Now to each one the manifestation of the Spirit is given for the common good.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Take the ten-day inventory and hear its final truth: none of it was for you alone. The manifestation of the Spirit is given for the common good — your gifts are heaven’s supplies routed through your hands to your generation.

This is why your gifting and your era match. The problems of your time are the address of your equipment: the skills you carry, the graces you have received, the crafts you have farmed — selected for the needs of the exact generation you were appointed to (Acts 17:26). David’s harp met Saul’s torment; Joseph’s administration met Egypt’s famine; your hands were issued for needs already on heaven’s schedule.

So go and be spent. Fan the flame, keep the staff surrendered, serve under load, refuse all burials. And when your generation eats from what was in your hands, you will understand why heaven filled them.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Which need of your generation matches what is in your hands?

— What is the first delivery you will make this month — gift to need?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, my hands are Yours and my generation is waiting. Route Your supplies through me — every gift deployed, every talent traded, nothing buried — until my hands are empty and my book is full. Amen.

_May your generation eat well from what heaven placed in your hands._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$1 Corinthians 12:4–11; Acts 13:36$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
