import React from "react";
import { Button, Box } from "@mui/material";
import { useMap } from "@mapcomponents/react-maplibre";

interface SetLocationButtonsProps {
  setBboxCenter: React.Dispatch<React.SetStateAction<[number, number]>>;
  setMapCenter: React.Dispatch<React.SetStateAction<[number, number]>>;
}

const locations = [
    { label: "New York", coords: [-74.006, 40.7128], zoom: 14 },
    { label: "Paris", coords: [2.3522, 48.8566], zoom: 15 },
    { label: "Tokyo", coords: [139.6503, 35.6762], zoom: 14 },
    { label: "Cologne", coords: [6.9603, 50.9375], zoom: 15 },
    { label: "Sofia", coords: [23.3219, 42.6977], zoom: 14 },
    { label: "Berlin", coords: [13.405, 52.52], zoom: 14 },
];

const SetLocationButtons: React.FC<SetLocationButtonsProps> = ({
  setBboxCenter,
  setMapCenter,
}) => {
  const mapHook = useMap();
  return (
    <Box sx={{ mt: 2 }}>
      {locations.map((loc) => (
        <Button
          key={loc.label}
          onClick={() => {
            setBboxCenter(loc.coords);
            setMapCenter(loc.coords);
            if (mapHook.map) {
              mapHook.map.flyTo({
                center: loc.coords,
                zoom: loc.zoom,
                speed: 1000,
              });
            }
          }}
        >
          {loc.label}
        </Button>
      ))}
    </Box>
  );
};

export default SetLocationButtons;
