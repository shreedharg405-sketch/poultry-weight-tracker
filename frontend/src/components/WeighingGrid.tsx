import React from 'react';
import { DigitalTallyMatrix } from './DigitalTallyMatrix';
import { Flock } from '../types';

export interface WeighingGridProps {
  flocks: Flock[];
  activeFlock: Flock | null;
  onFlockChange: (flock: Flock) => void;
  onSavedRecord: () => void;
}

/**
 * WeighingGrid: Interactive Digital 20g/50g Grid
 * Replicating Suguna Foods recording sheets with live uniformity, CV%, and fast tally matrix input
 */
export const WeighingGrid: React.FC<WeighingGridProps> = (props) => {
  return <DigitalTallyMatrix {...props} />;
};

export default WeighingGrid;
