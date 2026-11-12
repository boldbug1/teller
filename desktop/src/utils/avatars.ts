export interface CharacterStyle {
  name: string;
  imageSrc: string;
  gradient: string;
  primaryColor: string;
  glowColor: string;
  initials: string;
}

const FEMALE_TERMS = [
  "mrs", "miss", "ms", "lady", "mother", "daughter", "sister", "girl",
  "woman", "aunt", "queen", "princess", "duchess", "female", "madam",
];

const MALE_TERMS = [
  "mr", "sir", "father", "son", "brother", "boy", "man", "uncle",
  "king", "prince", "duke", "lord", "male", "sergeant", "captain", "gentleman",
];

function getInitials(name: string): string {
  const clean = name.replace(/[^\w\s]/gi, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "C";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getCharacterStyle(name: string, characterId?: string, traits: string[] = []): CharacterStyle {
  const lower = name.toLowerCase().trim();
  const idLower = (characterId || "").toLowerCase().trim();
  const allTerms = [lower, idLower, ...traits.map((t) => t.toLowerCase())];

  // 1. Narrator check
  if (lower.includes("narrator") || idLower === "narrator") {
    return {
      name,
      imageSrc: "",
      gradient: "linear-gradient(145deg, #e3a838, #c85a2d)",
      primaryColor: "#c85a2d",
      glowColor: "rgba(200, 90, 45, 0.32)",
      initials: "N",
    };
  }

  // 2. Female check
  const isFemale = FEMALE_TERMS.some((term) =>
    allTerms.some((t) => t.split(/\s+/).includes(term) || t.startsWith(term + " ") || t.startsWith(term + "."))
  );

  if (isFemale) {
    return {
      name,
      imageSrc: "",
      gradient: "linear-gradient(145deg, #c59082, #8c5b51)",
      primaryColor: "#8c5b51",
      glowColor: "rgba(140, 91, 81, 0.3)",
      initials: getInitials(name),
    };
  }

  // 3. Male check
  const isMale = MALE_TERMS.some((term) =>
    allTerms.some((t) => t.split(/\s+/).includes(term) || t.startsWith(term + " ") || t.startsWith(term + "."))
  );

  if (isMale) {
    return {
      name,
      imageSrc: "",
      gradient: "linear-gradient(145deg, #71858a, #3d5660)",
      primaryColor: "#3d5660",
      glowColor: "rgba(61, 86, 96, 0.3)",
      initials: getInitials(name),
    };
  }

  // 4. Default Neutral Persona
  return {
    name,
    imageSrc: "",
    gradient: "linear-gradient(145deg, #899077, #5e6a54)",
    primaryColor: "#5e6a54",
    glowColor: "rgba(94, 106, 84, 0.3)",
    initials: getInitials(name),
  };
}
