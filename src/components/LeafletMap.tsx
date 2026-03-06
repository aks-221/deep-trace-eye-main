import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default icon issue with bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface FlowNode {
  country: string;
  lat: number;
  lng: number;
  volume: number;
  count: number;
  pct: string;
  color?: string;
}

const FLOW_DATA: FlowNode[] = [
  { country: "Sénégal", lat: 14.692, lng: -17.447, volume: 4200000, count: 1245, pct: "42%", color: "#22c55e" },
  { country: "Côte d'Ivoire", lat: 5.354, lng: -4.006, volume: 2800000, count: 830, pct: "28%", color: "#f59e0b" },
  { country: "Mali", lat: 12.654, lng: -8.0, volume: 1800000, count: 530, pct: "18%", color: "#3b82f6" },
  { country: "Burkina Faso", lat: 12.364, lng: -1.533, volume: 800000, count: 235, pct: "8%", color: "#8b5cf6" },
  { country: "Guinée", lat: 11.863, lng: -15.592, volume: 400000, count: 115, pct: "4%", color: "#ec4899" },
  { country: "Mauritanie", lat: 18.0, lng: -15.9, volume: 120000, count: 42, pct: "1.2%", color: "#06b6d4" },
  { country: "Gambie", lat: 13.443, lng: -15.31, volume: 80000, count: 28, pct: "0.8%", color: "#f97316" },
];

interface LeafletMapProps {
  className?: string;
}

export default function LeafletMap({ className = "" }: LeafletMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Initialize map centered on West Africa
    const map = L.map(mapRef.current, {
      center: [12.5, -8],
      zoom: 5,
      zoomControl: true,
    });

    // Dark tile layer
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    // Add flow nodes
    FLOW_DATA.forEach((node) => {
      const radius = Math.max(10, Math.sqrt(node.volume / 10000));
      
      const circle = L.circleMarker([node.lat, node.lng], {
        radius,
        fillColor: node.color || "#22c55e",
        color: node.color || "#22c55e",
        weight: 2,
        opacity: 0.9,
        fillOpacity: 0.4,
      }).addTo(map);

      circle.bindTooltip(`
        <div style="font-family: monospace; font-size: 12px; padding: 4px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9;">
          <strong style="color: ${node.color}">${node.country}</strong><br/>
          Volume: <strong>${formatNumber(node.volume)} FCFA</strong><br/>
          Transactions: <strong>${node.count}</strong><br/>
          Part: <strong>${node.pct}</strong>
        </div>
      `, { permanent: false, direction: "top", className: "leaflet-tooltip-custom" });

      circle.on("click", () => setSelectedNode(node));
    });

    // Draw flow lines from Senegal (hub) to others
    const hub = FLOW_DATA[0];
    FLOW_DATA.slice(1).forEach((node) => {
      L.polyline([[hub.lat, hub.lng], [node.lat, node.lng]], {
        color: node.color || "#22c55e",
        weight: Math.max(1, node.volume / 1000000),
        opacity: 0.3,
        dashArray: "4 8",
      }).addTo(map);
    });

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div ref={mapRef} style={{ height: "100%", width: "100%", borderRadius: "8px" }} />
      {selectedNode && (
        <div className="absolute top-4 right-4 bg-card/95 border border-border rounded-lg p-4 shadow-xl z-[1000] min-w-48">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-foreground">{selectedNode.country}</span>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-muted-foreground hover:text-foreground text-lg leading-none"
            >
              ×
            </button>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Volume</span>
              <span className="font-semibold">{formatNumber(selectedNode.volume)} XOF</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Transactions</span>
              <span className="font-semibold">{selectedNode.count}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Part</span>
              <span className="font-semibold" style={{ color: selectedNode.color }}>{selectedNode.pct}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}
