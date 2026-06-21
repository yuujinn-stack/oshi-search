'use client';

import WorksImportSection from './WorksImportSection';
import VodImportSection from './VodImportSection';
import ToolsSection from './ToolsSection';

interface PersonInfo {
  name: string;
  group: string;
}

export default function CsvSection({ persons }: { persons: PersonInfo[] }) {
  return (
    <div className="space-y-6">
      <WorksImportSection persons={persons} />
      <VodImportSection persons={persons} />
      <ToolsSection persons={persons} />
    </div>
  );
}
