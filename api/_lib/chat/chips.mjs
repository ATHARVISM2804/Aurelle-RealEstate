/* Quick replies after each answer: rules on what just happened, localised. No model call. */

const T = {
  en: { avail: "What's available?", visit: 'Book a visit', amen: 'Amenities', loc: 'Where is it?', plans: 'Floor plans', higher: 'Higher floors', similar: 'Similar homes', brochure: 'Brochure', price: 'Price sheet', person: 'Talk to a person', video: 'Video call instead', specs: 'Finishes & specs', twobed: '2 bedroom homes', penthouse: 'Penthouses', directions: 'Directions' },
  ar: { avail: 'ما المتوفر؟', visit: 'احجز زيارة', amen: 'المرافق', loc: 'أين يقع؟', plans: 'المخططات', higher: 'طوابق أعلى', similar: 'وحدات مشابهة', brochure: 'الكتيب', price: 'قائمة الأسعار', person: 'تحدث مع موظف', video: 'مكالمة فيديو بدلاً من ذلك', specs: 'المواصفات', twobed: 'شقق بغرفتين', penthouse: 'البنتهاوس', directions: 'الاتجاهات' },
  hi: { avail: 'क्या उपलब्ध है?', visit: 'विज़िट बुक करें', amen: 'सुविधाएँ', loc: 'यह कहाँ है?', plans: 'फ़्लोर प्लान', higher: 'ऊँची मंज़िलें', similar: 'मिलते-जुलते घर', brochure: 'ब्रोशर', price: 'प्राइस शीट', person: 'किसी व्यक्ति से बात करें', video: 'वीडियो कॉल', specs: 'स्पेसिफ़िकेशन', twobed: '2 बेडरूम घर', penthouse: 'पेंटहाउस', directions: 'रास्ता' },
  'hi-Latn': { avail: 'Kya available hai?', visit: 'Visit book karein', amen: 'Amenities', loc: 'Location kahan hai?', plans: 'Floor plans', higher: 'Upar ke floors', similar: 'Similar ghar', brochure: 'Brochure', price: 'Price sheet', person: 'Kisi se baat karein', video: 'Video call', specs: 'Specs', twobed: '2 bedroom ghar', penthouse: 'Penthouse', directions: 'Directions' },
};

export function chipsFor({ lang = 'en', tools = [], booked = false, contact = false, unit = null }) {
  const t = T[lang] || T.en;
  const last = tools[tools.length - 1];
  let keys;
  if (booked) keys = ['directions', 'amen', 'person'];
  else if (last === 'search_units') keys = ['visit', 'higher', 'plans'];
  else if (last === 'get_unit') keys = ['visit', 'similar', 'brochure'];
  else if (last === 'offer_visit') keys = ['video', 'person'];
  else if (last === 'show_info') keys = ['avail', 'visit', 'specs'];
  else if (last === 'handoff_to_human' || last === 'request_contact') keys = ['avail', 'amen'];
  else if (unit) keys = ['similar', 'visit', 'price'];
  else keys = ['avail', 'visit', 'amen', 'loc'];
  if (contact) keys = keys.filter((k) => k !== 'price');
  return keys.map((k) => ({ label: t[k], send: t[k] }));
}

export function greetingChips(lang = 'en') {
  const t = T[lang] || T.en;
  return ['avail', 'visit', 'loc', 'amen'].map((k) => ({ label: t[k], send: t[k] }));
}
