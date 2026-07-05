-- Reseed whats-in-your-hand with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

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
  (1, 1, 'scripture', 'Today''s Reading', 'Ephesians 4:7–8', $dev$“But to each one of us grace has been given as Christ apportioned it. This is why it says: “When he ascended on high, he took many captives and gave gifts to his people.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Imagine an inheritance already deposited in your name, in an account you have never checked. You keep praying for provision that is quietly sitting there, gathering no interest only because you never looked. That is how most believers live with their gifting.

Paul is writing to a young church that is tempted to rank itself — some feeling second-class, others self-important. Into that anxiety he drops a settled fact: the ascended Christ, at the summit of His victory, distributed gifts to His people, and "to each one of us grace has been given." Not to the platformed few. Not to the naturally impressive. Each one. The image is of a conquering King who does not hoard the spoils of His triumph but scatters them among His own.

Here is the truth to build your week on: gifting in the kingdom is not a lottery some of us lost — it is an inheritance every child of God already holds. So the real question is never whether you were gifted, but what you were given and where it is hiding. And it usually hides in plain sight, disguised as "nothing special." The thing you do so easily you assume everyone does it — they do not. Familiarity is the veil over your gift.

So take the posture faith takes toward an inheritance it has not yet counted: not striving to earn, but searching to discover. Sit with the honest, expectant prayer — Lord, You gave; help me find where I put it. Ask the people who know you. Notice what comes easily. This week you are not begging for a gift; you are locating one.

You are not under-supplied. You are under-inventoried — and heaven is about to help you count.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What do you do so easily that you assumed "everyone" can do it?

— What have others repeatedly noticed in you that you quietly dismissed?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Ascended Lord, You gave gifts to Your people, and You did not skip me. Forgive me for living as though I received nothing while an inheritance sat in my name. Open my eyes to what You apportioned — especially what familiarity has hidden — and give me the courage to count it honestly this week. Amen.

_May you discover a treasure you have been carrying all along._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 4:7–13; 1 Corinthians 12:4–7$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Exodus 4:2', $dev$“Then the Lord said to him, “What is that in your hand?” “A staff,” he replied.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$God rarely answers our excuses the way we expect. Moses had just laid out his résumé of lack — who am I? what shall I say? what if they do not believe me? — a whole inventory of everything he did not have. And God replied with a question that changed history: "What is that in your hand?"

Look at where Moses is standing. Forty years earlier he was a prince with palace credentials; now he is a fugitive shepherd on the far side of a desert, holding the plainest object in his world — a wooden staff. Not a scepter, not a sword. A stick for driving sheep. Yet that is exactly where God begins. Notice the sequence carefully: Moses had to throw the staff down — surrender it — before it became a serpent and revealed a power it never had while he merely gripped it. Then, at God''s word, he took it up again, and from that moment Scripture calls it "the staff of God" (Exodus 4:20). Same wood. New ownership.

Here is the pattern of heaven: God does not import equipment from far away to use you; He anoints what is already in your hand. That staff went on to part a sea and strike water from rock — ordinary wood, extraordinary because it now belonged to God.

So name your staff honestly. It is whatever is already in your grip: a skill, a kitchen, a trade, a laptop, a voice, a small shop, a network of friends, a way with numbers. Heaven''s question to you is not "what do you lack?" — it never has been. It is "what is that in your hand?" Throw it down in surrender. Receive it back as His. Then watch what ordinary wood can do.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Name honestly what is already "in your hand" — list five ordinary things.

— Which one is God asking you to throw down and receive back as His?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, here is my staff — the ordinary things I carry and too easily despise. I throw them down before You; own them fully, and hand them back to me anointed. Use my plain wood for Your wonders, and let me stop waiting for equipment I do not need. Amen.

_May everything ordinary in your hands become extraordinary in His._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Exodus 4:1–20; John 6:8–13$dev$),
  (3, 1, 'scripture', 'Today''s Reading', '2 Timothy 1:6', $dev$“Paul tells Timothy: For this reason I remind you to fan into flame the gift of God, which is in you through the laying on of my hands.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Two people can carry the same word — "gift" — and mean completely different things, and the confusion quietly costs them years. Before you can steward what you carry, you have to sort it.

Paul reminds Timothy of a gift that came "through the laying on of my hands" — something imparted in the house of God, at a moment, by faith. That is one category, but not the only one. Scripture shows your equipment growing in three distinct ways. Gifts are issued — capacities woven into you from birth and by the Spirit: the born encourager, the natural leader, the intercessor whose prayers carry weight, the maker who cannot not create. Skills are farmed — abilities you acquire by learning and repetition: the trade, the craft, the language, the spreadsheet, the years of practice. And graces are imparted — like Timothy''s, received in the community of faith and activated by faith.

Why does the sorting matter? Because confusing the categories produces grief. People wait passively for skills, as if they will one day feel a skill descend — but skills must be farmed, worked for, drilled. And people strive anxiously for gifts, laboring to manufacture what was already issued — when gifts only need to be discovered and fanned. Misfiled equipment goes unused.

So do something concrete today: make three columns — issued, farmed, imparted — and take honest inventory. What capacities were you simply born carrying? What have you built through years of effort? What did God add through His people along the way? Do not rush it; ask others to help you fill the gaps.

Clarity about what you carry is the first true act of stewardship. You cannot deploy what you have never named.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Fill the three columns — issued, farmed, imparted — what goes where for you?

— Which column have you neglected, and what would honest attention to it look like?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, give me an accurate inventory — the issued, the farmed, and the imparted. Forgive me for waiting on what I should have worked for and straining for what You already gave. I receive each category with thanks, and I take up the stewardship of all three. Amen.

_May your three columns fill up with more than you expected to find._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$2 Timothy 1:6–7; Exodus 31:1–6$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Proverbs 18:16', $dev$“A gift opens the way and ushers the giver into the presence of the great.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Some of us are exhausted from pushing — angling for the introduction, working the connection, elbowing toward the front of a room we were never going to talk our way into. Here is a proverb that offers you an honorable retirement from all that striving.

"A gift opens the way and ushers the giver into the presence of the great." Read it slowly: it is not the giver who opens the way; it is the gift. A gift in genuine operation makes room for the one who carries it, escorting him before people that money cannot bribe and connections cannot reach. This is one of the quiet laws of the kingdom, and Scripture is full of it working.

Watch it play out. David''s skill on the harp carried a shepherd boy into a king''s court long before his sword ever did — his gift got him the invitation. Joseph''s ability to interpret lifted him from a dungeon to the second throne of Egypt between morning and noon. Daniel''s excellent spirit set a foreign captive over the administrators of an empire. Not one of them networked his way up. In every case, the gift was the escort; the person simply had to be found doing it well.

So here is the practical wisdom that reorders your effort: invest in the gift, not in the pushing. Stop spending your energy trying to force doors open, and spend it sharpening the thing in your hand until it speaks for itself. Serve with it wherever you already stand, even when no one important is watching — especially then. Let it do its ancient work.

Rooms you cannot yet imagine are already on heaven''s schedule to be opened — not by your striving, but by what is in your hands.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Where have you been elbowing when you should have been sharpening?

— What would one deliberate season of gift-sharpening actually look like for you?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, I resign from pushing and I report to sharpening. Free me from the anxious striving that trusts my elbows more than Your promise. Let my gift be my escort — and every room it opens, let me enter carrying Your name and not my own. Amen.

_May your gift quietly book rooms your résumé could never enter._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 18:16; 1 Samuel 16:14–23$dev$),
  (5, 1, 'scripture', 'Today''s Reading', '2 Timothy 1:6–7', $dev$“For this reason I remind you to fan into flame the gift of God… For the Spirit God gave us does not make us timid, but gives us power, love and self-discipline.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$A fire does not go out all at once. It dims. The flame drops to a glow, the glow to embers, the embers toward ash — and no one decided to let it die; it simply was not tended. That is how gifts fade, and it is exactly the danger Paul saw in Timothy.

Timothy''s gift was real, imparted, and publicly confirmed — and apparently going dim. Paul''s remedy tells you something crucial about how gifts are designed: they are given as embers, not as bonfires. "Fan into flame" is a command with breath in it — your active, continual attention is part of the design. God supplies the fire; you supply the oxygen.

So how does one fan an ember back to flame? Four things. Use it — gifts grow only in operation and never in storage; the unused gift always cools. Study it — the gifted who also train become the excellent; raw talent left untrained plateaus fast. Keep company — embers bundled together blaze, while a single coal pulled to the edge of the fire cools alone; you need people who are burning. And take courage — notice Paul turns immediately to timidity, because fear is the great smotherer of gifts. Countless flames have died quietly under the wet blanket of "who am I to…?"

Hear him clearly: the Spirit God gave you is not a spirit of timidity, but of power, love, and self-discipline. The fear that keeps your gift small is not from Him.

So identify your dimmed ember today — the gift you have stopped tending — and administer oxygen this week. One deliberate use. One hour of study. One bold yes you have been avoiding. Breathe on it, and it will roar.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Which gift of yours has dimmed from flame toward ember, or ember toward ash?

— What is this week''s oxygen for it — one use, one study, one bold yes?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Holy Spirit, breathe with me on the embers I have neglected. I renounce the timidity that has quietly smothered what You gave, and I refuse the lie that fear is humility. Help me fan the gift into flame — with use, with learning, with courage — until it burns bright again. Amen.

_May every dimmed ember in you roar back into holy flame._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$2 Timothy 1:3–7; 1 Timothy 4:14–15$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'John 6:9', $dev$“Here is a boy with five small barley loaves and two small fish, but how far will they go among so many?”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$"How far will they go among so many?" It is the honest math of every gift-carrier who has ever looked at their small offering and then at the size of the need. My little skill, my quiet voice, my one modest talent — against a crowd this hungry? The numbers do not work, and Andrew knew it: five loaves, two fish, five thousand men.

But watch what the boy does — the one move that arithmetic cannot argue with. He does not run the calculation. He simply puts what he has into the hands of Jesus. And in those hands, small stops being small. Everyone eats. Twelve baskets are left over. And a peasant boy''s packed lunch enters the eternal Scriptures, read on every continent two thousand years later.

Here is the lesson, and it is not merely that your gift is bigger than you think — though it is. The deeper lesson is that placement outranks size. Five loaves kept in a basket are five loaves; five loaves surrendered into the right hands become a feast for thousands. The multiplication was never in the bread. It was in the Hands.

So stop measuring your offering against the crowd. That comparison will always shame you into keeping your lunch — and a kept lunch feeds no one. Measure instead the Hands you are placing it in. Are they the hands that made the loaves in the first place? Then the size of your gift is not the relevant number.

Place it — daily, deliberately, without waiting to feel adequate — and let Him do the mathematics of multiplication that has never been yours to do.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— What "small lunch" have you been withholding because the crowd looks too big?

— What does placing it in His hands look like — concretely, this week?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, here is my lunch — small by every honest count but Yours. Forgive me for measuring it against the crowd instead of against Your hands. I place it in You. Do Your mathematics, and let multitudes eat from what I almost kept for myself. Amen.

_May your smallness, surrendered, out-feed every bigness that was kept._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$John 6:1–13; 2 Kings 4:1–7$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Exodus 31:2–4', $dev$“See, I have chosen Bezalel… and I have filled him with the Spirit of God, with wisdom, with understanding, with knowledge and with all kinds of skills — to make artistic designs…”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Ask most people to name the first person in the Bible described as "filled with the Spirit of God," and they will guess a prophet, a priest, a king. They would be wrong. The first man Scripture says was filled with the Spirit was a craftsman — Bezalel — and he was filled for metalwork, stonework, woodwork, and design.

Sit with how startling that is. The inaugural anointing recorded in Scripture did not fall on a preacher; it fell on a pair of skilled hands. Heaven anoints hands, not only pulpits. And that single fact demolishes a wall many believers quietly carry — the wall between "sacred" gifts that supposedly matter to God and "secular" ones that supposedly do not.

There is no such wall. The accountant''s precision, the builder''s trained eye, the farmer''s patient reading of soil and season, the coder''s ordered logic, the cook''s instinct for hospitality — when these are consecrated to God, they become Bezalel gifts: the Spirit''s workmanship flowing through human workmanship. God was not slumming when He filled a craftsman; He was showing us how He works.

So stop waiting to feel "spiritual" before you count your abilities as calling. You do not need a different set of gifts than the ones already in your hands; you need to consecrate the ones you have. Whatever your hands do with excellence can be filled with the Spirit and aimed at the building of God''s purposes in your generation.

The tabernacle needed preachers less than it needed one anointed craftsman that day — and your generation''s sanctuaries, in every sphere, are no different.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Which of your "secular" abilities might be a Bezalel gift awaiting consecration?

— What would it actually mean to do your ordinary craft "filled with the Spirit" this week?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Spirit of God, fill my hands the way You filled Bezalel''s. Tear down the false wall that made me think my work was too ordinary to matter to You. I consecrate my craft — every skill, every design, every day''s work — to the building of Your purposes. Amen.

_May your workmanship carry the unmistakable fingerprints of the Spirit._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Exodus 31:1–11; 35:30–35$dev$),
  (8, 1, 'scripture', 'Today''s Reading', '1 Peter 4:10', $dev$“Each of you should use whatever gift you have received to serve others, as faithful stewards of God’s grace in its various forms.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Here is why some sincere people cannot find their gift no matter how long they search: they are looking in stillness for something that only shows up in motion. You cannot find a muscle by staring at your arm on the couch. Put it under load, and suddenly you know exactly where it is.

Gifts are like that — invisible in contemplation, unmistakable in service. And Peter''s instruction quietly assumes it: "use whatever gift you have received to serve others." He does not say discover your gift and then serve; he says serve, and in the serving your gift will be found. Service is heaven''s gift-detection laboratory.

So volunteer broadly, and while you do, watch three honest gauges. First, energy: notice what leaves you filled while it drains everyone else in the room. Second, gratitude: notice the sincere thanks you receive for things you were not fishing for compliments about. Third, fruit: notice where your effort produces disproportionate results — where a little of you goes a long way. Where all three gauges point together, a gift is surfacing.

And notice the job title Peter hands you: "faithful stewards of God''s grace in its various forms." The gift is God''s property placed under your management. That ends pride at one door — it was received, not achieved — and neglect at the other — it will one day be accounted for. A steward cannot claim credit, and a steward cannot claim indifference.

So get under load this month. Stop waiting to feel qualified before you begin. Your gifts are not hiding from you; they are waiting for you in the serving.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Where can you volunteer this month, broadly enough to test the three gauges?

— What has already energized you, drawn genuine thanks, and borne easy fruit?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, I stop searching in stillness for what only service reveals. I enter the laboratory of serving Your people — put me under load, read the gauges with me, and surface the gifts You stored there for me to find. Make me a faithful steward, proud of nothing and neglectful of nothing. Amen.

_May service reveal in you what a decade of self-searching never could._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$1 Peter 4:8–11; Romans 12:4–8$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Matthew 25:24–25', $dev$“Master,” he said, “I knew that you are a hard man… so I was afraid and went out and hid your gold in the ground.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$The servant with one talent did not squander it on wild living, did not gamble it away, did not lose it to thieves. He buried it — kept it perfectly safe — and returned it intact, fully expecting to be commended for his caution. Instead he heard some of the hardest words in any of Jesus'' parables.

That should stop us, because his instinct feels so responsible. Yet in the kingdom''s accounting, unused is not the same as neutral. Preservation without deployment is counted as loss. The gift buried for safekeeping is, in the Master''s ledger, a gift wasted — because it was given to be traded, not stored.

Now read his motive, because it lives in many of us: "I was afraid." Fear of failing publicly. Fear of the Master''s judgment. Fear of comparison with the five-talent servants who seemed so far ahead. And underneath it all — note this carefully — a distorted picture of the Master as harsh: "I knew that you are a hard man." The lie about God''s character produced the paralysis of God''s gift. That is nearly always the root. We do not bury gifts because we are lazy; we bury them because, deep down, we are afraid of a God we have misread.

But you have been rebuilding that picture. The real Master is not standing over you with folded arms; He multiplies joy to faithful risk-takers and says, "Come and share your master''s happiness!" Fear buried the talent by lying about His face.

So hold a small exhumation today. Name the buried gift. Name the fear that dug the hole. Correct the picture of God that made burial feel safe. And put a spade in the ground.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— What talent have you buried — and which specific fear held the spade?

— What false picture of God made the burial feel like the safe, responsible choice?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Master of joy, I dig up what fear buried. Forgive me for reading You as harsh when You are generous, and for calling my paralysis prudence. Correct my picture of You, and receive my talent back into trade — I would rather risk with You than rust without You. Amen.

_May everything fear ever buried in you come up out of the ground this week._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 25:14–30$dev$),
  (10, 1, 'scripture', 'Today''s Reading', '1 Corinthians 12:7', $dev$“Now to each one the manifestation of the Spirit is given for the common good.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Take the whole ten-day inventory — the staff, the three columns, the fanned ember, the surrendered lunch, the anointed craft, the unburied talent — and hear its final, reorienting truth: none of it was ever for you alone.

"The manifestation of the Spirit is given for the common good." Your gifts are not private property; they are heaven''s supplies, routed through your particular hands to the people around you. God did not equip you so you could feel equipped. He equipped you so a generation could be served.

And this is precisely why your gifting and your era fit together so exactly. The problems of your time are the address written on your equipment. The skills you have farmed, the graces you have received, the crafts you have consecrated — they were selected for the needs of the exact generation you were appointed to live in. Paul told the Athenians that God "marked out their appointed times in history and the boundaries of their lands" (Acts 17:26); you were not dropped into your century by accident. David''s harp was issued for a Saul who would need soothing. Joseph''s administration was issued for a famine that had not yet come. Your hands were filled for needs already on heaven''s schedule.

So go and be spent. Fan the flame; keep the staff surrendered; serve under load; refuse every burial. Do not die with your inheritance uncounted and your hands still full.

And on the day your generation eats from what was in your hands, you will finally understand why heaven took such care to fill them.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Which specific need of your generation matches what is now in your hands?

— What is the very first delivery you will make this month — gift to need?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, my hands are Yours and my generation is waiting. Route Your supplies through me — every gift deployed, every talent traded, nothing buried, nothing wasted — until my hands are empty and my book is full. Let those around me eat from what You placed in me. Amen.

_May your generation eat well from what heaven placed in your hands._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$1 Corinthians 12:4–11; Acts 13:36$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
