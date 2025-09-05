import React from 'react';
import HawkActor from './HawkActor';
import { useHawk } from './useHawk';

interface HawkTrailProps {
  className?: string;
  hawkSize?: number;
}

const HawkTrail: React.FC<HawkTrailProps> = ({ 
  className = '', 
  hawkSize = 24 
}) => {
  const { mood } = useHawk();

  return (
    <div className={`hawk-trail ${className}`}>
      <HawkActor 
        mood={mood} 
        size={hawkSize}
        className="hawk-icon"
      />
    </div>
  );
};

export default HawkTrail;
