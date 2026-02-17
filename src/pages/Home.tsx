import { Link } from 'react-router-dom';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';

interface ScriptModule {
  id: string;
  name: string;
  description: string;
  path: string;
  icon: string;
  status: 'available' | 'coming-soon';
}

const modules: ScriptModule[] = [
  {
    id: 'csv-import',
    name: 'CSV Entity Import',
    description: 'Import entities from a CSV file using the V2 API. Map columns to fields, preview before import, and handle duplicates.',
    path: '/csv-import',
    icon: '📥',
    status: 'available',
  },
  {
    id: 'custom-field-migration',
    name: 'Custom Field Migration',
    description: 'Migrate values between Productboard custom fields. Map source fields to target fields and bulk update across all features.',
    path: '/custom-field-migration',
    icon: '🔄',
    status: 'available',
  },
  {
    id: 'duplicate-notes',
    name: 'Delete Duplicate Notes',
    description: 'Find and delete duplicate notes based on content, title, and company. Preview duplicates before deletion with smart keep/delete logic.',
    path: '/duplicate-notes',
    icon: '🗑️',
    status: 'available',
  },
  {
    id: 'csv-bulk-update',
    name: 'CSV Bulk Update',
    description: 'Update existing features\' custom field values from a CSV file. Map value columns to custom fields and bulk update by feature UUID.',
    path: '/csv-bulk-update',
    icon: '📝',
    status: 'available',
  },
  {
    id: 'csv-note-import',
    name: 'CSV Note Import',
    description: 'Import notes from a CSV file. Map columns to title, note text, user email, owner, and tags with drag-and-drop ordering.',
    path: '/csv-note-import',
    icon: '📋',
    status: 'available',
  },
  {
    id: 'csv-company-import',
    name: 'CSV Company Import',
    description: 'Import companies from a CSV file. Creates new companies or updates existing ones with custom field values.',
    path: '/csv-company-import',
    icon: '🏢',
    status: 'available',
  },
];

export default function Home() {
  const usageStats = useQuery(api.usageStats.getAll) ?? {};
  const incrementUsage = useMutation(api.usageStats.increment);

  // Find the module with the highest count for "Most Popular" badge
  const maxCount = Math.max(0, ...Object.values(usageStats));
  const mostPopularId = maxCount > 0
    ? Object.entries(usageStats).find(([, count]) => count === maxCount)?.[0]
    : null;

  const handleModuleClick = (moduleId: string) => {
    incrementUsage({ moduleId });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-12 px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Productboard Tools</h1>
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-gray-600">Made by</span>
            <img
              src="/calvin-owens.jpeg"
              alt="Calvin Owens"
              className="w-8 h-8 rounded-full object-cover"
            />
            <span className="text-gray-600">Calvin Owens</span>
          </div>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            A collection of tools for running API operations on Productboard workspaces.
            Select a script below to get started. Not an official Productboard tool.
          </p>
        </div>

        {/* Module Tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((module) => (
            <ModuleTile
              key={module.id}
              module={module}
              count={usageStats[module.id] ?? 0}
              isPopular={module.id === mostPopularId}
              onClick={() => handleModuleClick(module.id)}
            />
          ))}

          {/* Placeholder for future modules */}
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center text-gray-400 min-h-[200px]">
            <span className="text-3xl mb-2">+</span>
            <span className="text-sm">More scripts coming soon</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ModuleTileProps {
  module: ScriptModule;
  count: number;
  isPopular: boolean;
  onClick: () => void;
}

function ModuleTile({ module, count, isPopular, onClick }: ModuleTileProps) {
  const isAvailable = module.status === 'available';

  if (!isAvailable) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 opacity-60 cursor-not-allowed">
        <div className="text-4xl mb-4">{module.icon}</div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">{module.name}</h3>
        <p className="text-gray-600 text-sm mb-4">{module.description}</p>
        <span className="inline-block px-3 py-1 bg-gray-100 text-gray-500 text-xs rounded-full">
          Coming Soon
        </span>
      </div>
    );
  }

  return (
    <Link
      to={module.path}
      onClick={onClick}
      className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md hover:border-blue-300 transition-all group relative"
    >
      {isPopular && (
        <span className="absolute top-3 right-3 inline-flex items-center px-2 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-full">
          ⭐ Most Popular
        </span>
      )}
      <div className="text-4xl mb-4">{module.icon}</div>
      <h3 className="text-xl font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
        {module.name}
      </h3>
      <p className="text-gray-600 text-sm mb-4">{module.description}</p>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center text-blue-600 text-sm font-medium group-hover:gap-2 transition-all">
          Open Script
          <span className="ml-1 group-hover:translate-x-1 transition-transform">→</span>
        </span>
        <span className="text-xs text-gray-400">{count} uses</span>
      </div>
    </Link>
  );
}
