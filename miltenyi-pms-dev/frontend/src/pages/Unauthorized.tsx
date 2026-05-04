import { useNavigate } from "react-router-dom";
import { ShieldOff } from "lucide-react";

/**
 * Shown when an authenticated user attempts to access a route whose
 * feature flag is not enabled for their organization.
 */
export default function Unauthorized() {
  const navigate = useNavigate();

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4"
      aria-labelledby="unauthorized-heading"
    >
      <div className="text-center">
        <ShieldOff
          className="mx-auto mb-4 h-16 w-16 text-gray-400"
          aria-hidden="true"
        />
        <h1
          id="unauthorized-heading"
          className="text-2xl font-semibold text-gray-800"
        >
          Feature Not Available
        </h1>
        <p className="mt-2 text-gray-500">
          Your organization does not have access to this module. Contact your
          administrator if you believe this is an error.
        </p>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="mt-6 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Back to Dashboard
        </button>
      </div>
    </main>
  );
}
