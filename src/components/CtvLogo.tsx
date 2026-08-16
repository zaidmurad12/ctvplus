import React from "react";

interface CtvLogoProps {
  className?: string;
}

export const CtvLogo: React.FC<CtvLogoProps> = ({ className = "w-10 h-6" }) => {
  return (
    <div className="flex items-center justify-center select-none">
      <svg 
        viewBox="0 0 120 48" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg" 
        className={className}
      >
        <text
          x="60"
          y="36"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="46"
          fontWeight="900"
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
          letterSpacing="-0.07em"
        >
          ctv
        </text>
      </svg>
    </div>
  );
};

export default CtvLogo;
