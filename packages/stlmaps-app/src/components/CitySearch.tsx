import React, { useState } from 'react';
import { 
  Autocomplete, 
  TextField, 
  Box, 
  Typography,
  InputAdornment
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useMap } from '@mapcomponents/react-maplibre';
import cities, { City } from '../data/cities';

interface CitySearchProps {
  onCitySelect?: (city: City | null) => void;
}

const CitySearch: React.FC<CitySearchProps> = ({ onCitySelect }) => {
  // Get the maplibre instance using useMap hook
  const { map } = useMap();
  const [value, setValue] = useState<City | null>(null);
  const [inputValue, setInputValue] = useState('');

  const jumpToCity = (city: City | null) => {
    if (city && map) {
      // Fly to the selected city's coordinates with animation
      map.flyTo({
        center: city.coordinates,
        zoom: 14,
        essential: true, // this animation is considered essential for the user experience
      });
      
      // Optional callback for parent component if needed
      if (onCitySelect) {
        onCitySelect(city);
      }
    }
  };

  const handleCityChange = (_event: React.SyntheticEvent, newValue: City | null) => {
    setValue(newValue);
    jumpToCity(newValue);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      // Find city by exact name match when user presses Enter
      const exactMatch = cities.find(city => city.name.toLowerCase() === inputValue.toLowerCase());
      if (exactMatch) {
        setValue(exactMatch);
        jumpToCity(exactMatch);
      }
    }
  };

  return (
    <Box sx={{ width: 300, mx: 2 }}>
      <Autocomplete
        id="city-search"
        options={cities}
        autoHighlight
        freeSolo
        selectOnFocus
        handleHomeEndKeys
        getOptionLabel={(option) => typeof option === 'string' ? option : option.name}
        filterOptions={(options, state) => {
          const inputValue = state.inputValue.toLowerCase().trim();
          return options.filter(option => 
            option.name.toLowerCase().includes(inputValue) || 
            option.country.toLowerCase().includes(inputValue)
          );
        }}
        renderOption={(props, option) => (
          <Box component="li" {...props}>
            <Typography variant="body1">{option.name}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
              {option.country}
            </Typography>
          </Box>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Search for a city"
            variant="outlined"
            size="small"
            onKeyDown={handleKeyDown}
            InputProps={{
              ...params.InputProps,
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ 
              backgroundColor: 'background.paper',
              borderRadius: 1
            }}
          />
        )}
        value={value}
        onChange={handleCityChange}
        inputValue={inputValue}
        onInputChange={(_event, newInputValue) => {
          setInputValue(newInputValue);
        }}
      />
    </Box>
  );
};

export default CitySearch;
