const INFERENCE_ALGO_VERSION = 1;

const DEFAULT_PARAMS = {
  R_clip_m: 2000,
  epsilon_simplify_m: 10,
  tangent_half_length_m: 120,
  min_arc_each_side_m: 40,
  max_pin_to_P_m: 250,
  max_normal_vs_pin_deg: 45,
};

module.exports = {
  INFERENCE_ALGO_VERSION,
  DEFAULT_PARAMS,
};
