import { useState, useCallback } from 'react';

export interface SelectedAgentHook {
  selectedAgentId: string | null;
  selectAgent: (id: string | null) => void;
}

export function useSelectedAgent(): SelectedAgentHook {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const selectAgent = useCallback((id: string | null) => {
    setSelectedAgentId((prev) => (prev === id ? null : id));
  }, []);

  return { selectedAgentId, selectAgent };
}
