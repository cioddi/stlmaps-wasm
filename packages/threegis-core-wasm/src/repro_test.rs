#[cfg(test)]
mod tests {
    use crate::polygon_geometry::calculate_building_vertical_scale;

    #[test]
    fn test_building_vertical_scale() {
        let min_elevation = 0.0;
        let max_elevation = 100.0;
        let vertical_exaggeration = 3.5;
        // EXAGGERATION_SCALE_FACTOR is 5.0 (internal constant)
        // expected scale = (3.5 * 5.0) / 100.0 = 17.5 / 100.0 = 0.175

        let scale = calculate_building_vertical_scale(min_elevation, max_elevation, vertical_exaggeration);
        assert!((scale - 0.175).abs() < 1e-6);

        // Test with higher exaggeration
        let high_exag = 10.0;
        let scale_high = calculate_building_vertical_scale(min_elevation, max_elevation, high_exag);
        // expected = (10.0 * 5.0) / 100.0 = 0.5
        assert!((scale_high - 0.5).abs() < 1e-6);
        
        // Confirm scaling increases with exaggeration
        assert!(scale_high > scale);
    }
}
