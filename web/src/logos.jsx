import { createContext, useContext, useState } from "react";

// Team abbreviation → logo URL, from the slate index (`logos`, ESPN CDN, dark-bg variant).
export const LogoContext = createContext({});

// Logo + abbreviation. If the image is missing or fails to load, only the text shows.
export function Team({ abbr, size = 18 }) {
  const logos = useContext(LogoContext);
  const [failed, setFailed] = useState(false);
  const src = logos?.[abbr];
  return (
    <span className="team-id">
      {src && !failed && (
        <img className="team-logo" src={src} alt="" width={size} height={size} loading="lazy"
             onError={() => setFailed(true)} />
      )}
      {abbr}
    </span>
  );
}
