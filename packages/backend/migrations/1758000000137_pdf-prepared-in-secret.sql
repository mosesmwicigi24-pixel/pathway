-- Prepared in Secret: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'prepared-in-secret');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Luke 2:52', 'The Hidden Years of the Son of God'),
  (2, 'Isaiah 40:31', 'The Eagle Renews in Hiding'),
  (3, 'Luke 2:46', 'Found Among the Teachers, Asking Questions'),
  (4, 'Luke 14:28', 'Count the Cost, Build the Tower'),
  (5, 'Psalm 78:70–71', 'The Sheep Pens Before the Throne'),
  (6, 'Psalm 105:19', 'Joseph: Prepared by the Very Delay'),
  (7, 'Exodus 3:1', 'The Desert Curriculum'),
  (8, 'Esther 2:12', 'Esther''s Twelve Months of Oil'),
  (9, 'Ecclesiastes 9:11', 'Chance Favors the Prepared'),
  (10, 'Luke 16:12', 'Faithful in Another Man''s Vineyard')
) AS v(n, ref, title) WHERE p.code = 'prepared-in-secret';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'prepared-in-secret'
JOIN (VALUES
  (1, 1, 'scripture',  'Today''s Reading', 'Luke 2:52', $dev$“And Jesus grew in wisdom and stature, and in favor with God and man.”$dev$),
  (1, 2, 'devotional', 'Devotional',       NULL,     $dev$The most important life ever lived was ninety percent hidden. Thirty years in Nazareth — a carpenter's bench, a village's dust, an ordinary name — before three years of public ministry. From age twelve, the Scripture goes silent for eighteen years, summarized in one sentence: He grew.

If the Son of God did not skip the hidden years, they cannot be a punishment. They are a curriculum. In Nazareth, Jesus practiced everything He would later preach: honoring parents, handling money, serving neighbors, waiting on the Father's timing while carrying the world's greatest calling unannounced.

So begin this plan by re-labeling your season. Not “forgotten.” Not “passed over.” Growing in wisdom, stature and favor — the same file heaven kept on Jesus. Hidden is not the opposite of chosen. For a long and holy stretch, hidden is what chosen looks like.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What label have you been writing on your hidden season?

— What might the Nazareth curriculum be teaching you right now?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,     $dev$Lord Jesus, You honored the hidden years — so I will honor mine. Re-label my season with heaven's file: growing in wisdom, stature and favor. Amen.

_May you carry your hidden season the way Jesus carried Nazareth — unhurried and unashamed._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 2:41–52; Philippians 2:5–11$dev$),
  (2, 1, 'scripture',  'Today''s Reading', 'Isaiah 40:31', $dev$“But those who hope in the Lord will renew their strength. They will soar on wings like eagles…”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,     $dev$There is a season when the eagle — the very king of the skies — withdraws from view. Feathers weathered, beak worn, it retreats to the heights and goes through a painful renewal: old plumage shed, new strength grown. The bird that finally rises looks reborn — because it is.

The eagle does not molt in mid-air, and neither do you. Some renewals require withdrawal: seasons when God takes you off the stage not to shelve you but to re-feather you — new strength, new sharpness, new wind.

If your visibility has shrunk lately, ask before you panic: is this rejection, or renewal? “Those who hope in the Lord will renew their strength” — and renewal has always loved privacy. Cooperate with the molting. What rises from this hiding will out-fly what entered it.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Could your reduced visibility be renewal rather than rejection?

— What "old feathers" — methods, dependencies, self-images — is God shedding from you?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,     $dev$Father, I stop fighting the hiding. Renew me in it — shed what is worn, grow what is new, and when You lift me, let me soar on fresh wings. Amen.

_May you leave this hidden season wearing wings it grew for you._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,     $dev$Isaiah 40:27–31; Psalm 103:5$dev$),
  (3, 1, 'scripture',  'Today''s Reading', 'Luke 2:46', $dev$“After three days they found him in the temple courts, sitting among the teachers, listening to them and asking them questions.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,     $dev$Catch the one glimpse we have of the hidden Jesus: twelve years old, in the temple — not performing, but listening and asking questions. The posture of preparation is the posture of a learner.

At age twelve, Jesus was asking hard questions in the temple; from that day, for eighteen years, the Bible is silent — until a prepared Man stepped into the Jordan. The silence was not empty. It was study.

Hidden seasons are learning seasons, and the tragedy is to spend them sulking instead of studying. What should this season teach you? The skill your future assignment requires? The Scriptures you have skimmed but never mined? The craft, the language, the patience? Sit among the teachers — books, mentors, the Word — listening and asking. When your Jordan moment comes, you will step into it prepared.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What is this season offering to teach that you have been too frustrated to learn?

— "Sit among the teachers": which book, mentor or study will you take up this month?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,     $dev$Father, turn my waiting room into a classroom. Give me the twelve-year-old's posture — listening, asking, learning — until the Jordan calls my name. Amen.

_May your hidden years be found, later, to have been your best-attended school._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 2:41–52; Proverbs 4:5–9$dev$),
  (4, 1, 'scripture',  'Today''s Reading', 'Luke 14:28', $dev$“Suppose one of you wants to build a tower. Won’t you first sit down and estimate the cost to see if you have enough money to complete it?”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,     $dev$Greatness happens through intense preparation — and Jesus gives preparation its picture: a builder, seated, counting the cost before the tower rises. Counting the cost means seeing whether you have what it takes to finish the building, and gathering it before you begin.

This is the hidden season's great privilege: you can gather now what the assignment will spend later. Character enough to survive promotion. Prayer depth enough to survive pressure. Skill enough to survive scrutiny. Half-built towers advertise unprepared builders — and many public collapses are simply private preparations that never happened.

God created us great — but some people sought permission to be petty; they wanted towers without arithmetic. Not you. Sit down today with your calling and count honestly: what will finishing require that you do not yet have? That list is your hidden season's syllabus.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What will your calling's "tower" require that you do not yet possess?

— Turn the gap into a syllabus: what will you gather this season?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,     $dev$Master Builder, I sit down and count. Show me the true cost of my calling, and let this hidden season gather everything the finishing will spend. Amen.

_May your tower, when it rises, testify of the seasons you sat and counted._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 14:25–33; Proverbs 24:27$dev$),
  (5, 1, 'scripture',  'Today''s Reading', 'Psalm 78:70–71', $dev$“He chose David his servant and took him from the sheep pens; from tending the sheep he brought him to be the shepherd of his people Jacob.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,     $dev$When Samuel came to anoint a king, David was not even invited to the lineup — the youngest, left with the flock, forgotten by his own father in the day of selection. But hear the Psalm's geography of promotion: God took him from the sheep pens. Heaven knew the address of the overlooked boy.

And the pens were not wasted years; they were the throne's curriculum. Watching sheep taught him to watch people; fighting lions calibrated him for giants; solitary nights with a harp wrote the psalms a nation still prays. Same skills, larger flock.

Notice too: even after anointing, David returned to the sheep. Anointed, and still hidden — the oil on his head and the wool in his hands. If that is your season — confirmed calling, unchanged circumstances — you are in royal company. The God who knows the pens' address has not misplaced yours.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Where have you felt "left out of the lineup" — and can you trust heaven knows your address?

— What is your current "flock" teaching that your future "kingdom" will need?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,     $dev$Father, You take people from sheep pens. I will tend what is before me with all my heart — anointed or overlooked — until You come for me at the address You have always known. Amen.

_May the oil on your head keep you faithful with the wool in your hands._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,     $dev$1 Samuel 16:1–13; Psalm 78:70–72$dev$),
  (6, 1, 'scripture',  'Today''s Reading', 'Psalm 105:19', $dev$“Until the time came to fulfill his dreams, the Lord tested Joseph’s character.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,     $dev$Between Joseph's dream and Joseph's throne stood thirteen years of descent — a pit, a slave's quarters, a dungeon. Any observer would have said the dream had died three times. But read what heaven was doing in the same years: the word of the Lord tested him.

And look closer: every station was secretly a school for the palace. Potiphar's house taught him to run an estate; the prison, of all places, taught him to administer people and systems. Egypt's future prime minister did his internship in a dungeon — and the very delay became the preparation.

God wastes nothing: not the betrayal, not the false accusation, not the forgotten favor (the cupbearer forgot him two full years). When the dream finally called, Joseph was ready in a single morning — shaved, dressed, and equal to a nation's crisis. Your delays are enrollments. Attend the classes.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What is your current "station" secretly teaching that your dream will require?

— Where has a delay tempted you to declare the dream dead?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,     $dev$God of Joseph, I enroll in the classes of my delay. Test my character kindly, teach me in every station, and when the dream calls — find me ready in a morning. Amen.

_May every dungeon in your story turn out to have been an internship for a palace._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,     $dev$Genesis 37, 39–41; Psalm 105:16–22$dev$),
  (7, 1, 'scripture',  'Today''s Reading', 'Exodus 3:1', $dev$“Now Moses was tending the flock of Jethro his father-in-law… and he led the flock to the far side of the wilderness…”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,     $dev$Moses spent forty years in Pharaoh's palace learning to be somebody; forty years in the desert learning to be nobody; and forty years showing what God can do with a man who has learned both. The middle forty looked like pure waste — a prince reduced to a shepherd on the backside of nowhere.

But trace the geography: the wilderness where Moses kept sheep was the very wilderness through which he would one day lead a nation. He was mapping his future mission field and calling it exile. The wells, the weather, the ways of the desert — every ordinary day was reconnaissance.

God hides His deliverers in the terrain of their coming deliverance. The organization frustrating you, the community you feel buried in, the problems you know too well — look again. You may not be buried. You may be planted, in the exact soil of your assignment.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What "terrain" do you know intimately that felt like exile — could it be reconnaissance?

— What burning bush might be standing in your ordinary landscape?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,     $dev$Father, re-map my wilderness. If this ground is my future mission field, open my eyes — and when the bush burns, find me faithful with the flock in my hands. Amen.

_May the ground you called exile reveal itself as your appointed mission field._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,     $dev$Exodus 2:11–3:12; Acts 7:29–34$dev$),
  (8, 1, 'scripture',  'Today''s Reading', 'Esther 2:12', $dev$“Before a young woman’s turn came… she had to complete twelve months of beauty treatments prescribed for the women, six months with oil of myrrh and six with perfumes and cosmetics.”$dev$),
  (8, 2, 'devotional', 'Devotional',       NULL,     $dev$Between Esther's selection and Esther's crown stood a full year of preparation — twelve months of oil, prescribed and unhurried, before one evening with the king. And years later, when a nation's survival hung on her access to the throne, every month of that preparation mattered.

Notice: Esther did not design her preparation; she submitted to it. Hidden seasons often come with disciplines we would not have chosen — the humbling job, the small church, the long training, the closed door that keeps us soaking longer. The oil decides the readiness; the calendar belongs to God.

And mark the destination: preparation was never about the palace's luxury but about a moment — “for such a time as this” (Esther 4:14). Somewhere ahead of you is your such-a-time. The soaking you resent today is the composure you will reign with then.$dev$),
  (8, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What prescribed "oil" — discipline, training, waiting — are you currently soaking in reluctantly?

— How does a coming "such a time as this" change the way you soak?$dev$),
  (8, 4, 'devotional', 'Pray',             NULL,     $dev$Father, I submit to the oil. Prescribe my preparation, set my calendar, and when my such-a-time comes, let twelve hidden months speak in one decisive moment. Amen.

_May every month of oil be found, at your decisive moment, to have been exactly enough._$dev$),
  (8, 5, 'reading',    'Go Deeper',        NULL,     $dev$Esther 2:8–17; 4:12–16$dev$),
  (9, 1, 'scripture',  'Today''s Reading', 'Ecclesiastes 9:11', $dev$“The race is not to the swift or the battle to the strong… but time and chance happen to them all.”$dev$),
  (9, 2, 'devotional', 'Devotional',       NULL,     $dev$The Preacher noticed what we all notice: outcomes do not always follow talent. The swift lose races; the strong lose battles; time and chance happen to them all. Doors swing open unannounced — and swing shut the same way.

Since opportunities cannot be scheduled, they can only be prepared for. The scientist Louis Pasteur said it in the laboratory — chance favors the prepared mind — and Scripture had staged it centuries earlier: Joseph could not have arranged Pharaoh's dreams, but he had spent thirteen years becoming the man who could interpret them. The cupbearer's memory returned suddenly; Joseph's readiness had been built slowly.

You cannot control when your door opens. You entirely control who is standing there when it does. Prepare as if the knock were tonight — because time and chance are already on their way to your address.$dev$),
  (9, 3, 'talk',       'Talk it Over',     NULL,     $dev$— If your biggest door opened tonight, what part of you would be unready?

— What will you do this month so the knock finds you standing?$dev$),
  (9, 4, 'devotional', 'Pray',             NULL,     $dev$Lord of times and seasons, I cannot schedule my door — so I will prepare for it. Build in me, slowly and surely, the readiness that sudden moments reveal. Amen.

_May every sudden door of your life find you already dressed._$dev$),
  (9, 5, 'reading',    'Go Deeper',        NULL,     $dev$Ecclesiastes 9:10–11; Genesis 41:14–40$dev$),
  (10, 1, 'scripture',  'Today''s Reading', 'Luke 16:12', $dev$“And if you have not been trustworthy with someone else’s property, who will give you property of your own?”$dev$),
  (10, 2, 'devotional', 'Devotional',       NULL,     $dev$Here is the hidden season's final exam, and it is taken daily: how do you serve what belongs to someone else? Another leader's vision. Another company's growth. Another ministry's platform. Jesus makes the principle explicit — your own comes to those proven trustworthy with another's.

Elisha poured water on Elijah's hands for years — and inherited a double portion. Joshua carried Moses' tent duties — and inherited the crossing. The men who received mantles were the men who had carried someone else's luggage without bitterness.

So close this plan with the commissioning of the hidden: serve your present assignment as if it were the dream itself — because in God's ledger, it is. Be the armor-bearer who makes another king great. The world is too busy to stand and admire you; but heaven is not too busy — it is watching, recording, and preparing your own vineyard even now.$dev$),
  (10, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Whose "vineyard" are you serving now — and with how much of your heart?

— What would wholehearted service look like this week, applause or none?$dev$),
  (10, 4, 'devotional', 'Pray',             NULL,     $dev$Father, I take the towel in another man's vineyard with joy. Find me trustworthy with what is his — and in Your time, hand me what is mine. Amen.

_May your faithfulness in another's vineyard be answered with a harvest in your own._$dev$),
  (10, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 16:10–12; 2 Kings 2:1–14$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
