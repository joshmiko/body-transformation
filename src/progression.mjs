// Decision support for the weekly Coach proposal. This never mutates a program.
export function evaluateProgression(exercise, workoutExercise, options = {}) {
  const plannedSets = Number(exercise?.sets);
  const rows = Array.isArray(workoutExercise?.workingSets)
    ? workoutExercise.workingSets
    : Array.isArray(workoutExercise?.actual) ? workoutExercise.actual : [];
  const prescribed = rows.filter(row => !row?.added).slice(0, plannedSets);
  const hold = reason => ({ decision: "hold", reason, suggestedWeightLb: null });
  if (!Number.isInteger(plannedSets) || plannedSets < 1 || prescribed.length !== plannedSets) return hold("Incomplete prescribed set data.");
  if (workoutExercise?.substitution || (workoutExercise?.performedExercise && workoutExercise.performedExercise !== exercise.name)) return hold("A substitution needs its own load history.");
  if (exercise.machine && options.performedMachine && exercise.machine !== options.performedMachine) return hold("The machine changed.");
  if (options.painOrInjuryConcern) return hold("Pain or injury concern needs a human review.");
  if (prescribed.some(row => row.status !== "completed" || row.done === false)) return hold("A prescribed working set was not completed.");
  if (prescribed.some(row => row.feel === "Failed")) return { decision: "review-reduction", reason: "A working set failed; review recovery and load before repeating.", suggestedWeightLb: null };
  if (prescribed.some(row => !["Easy", "Good"].includes(row.feel))) return hold("Hard or missing effort feedback; repeat the load and build quality.");
  if (prescribed.some(row => Number(row.reps ?? row.seconds) < Number(exercise.max))) return hold("Not all prescribed sets reached the top of the range.");
  const rest = Number(exercise.rest);
  if (rest > 0 && prescribed.slice(1).some(row => row.actualRestSec != null && Number(row.actualRestSec) > rest * 1.5)) return hold("Longer rest makes this result non-comparable; Coach should review.");
  if (exercise.unit === "sec") return { decision: "review-duration", reason: "Duration reached the top of the range; review the next duration target.", suggestedWeightLb: null };
  if (exercise.loadType === "bodyweight") return { decision: "review-bodyweight", reason: "All bodyweight sets reached the top; review whether to add load.", suggestedWeightLb: null };
  const weights = prescribed.map(row => Number(row.weight));
  if (weights.some(weight => !Number.isFinite(weight) || weight <= 0)) return hold("Missing or invalid working weight.");
  if (weights.some(weight => weight !== weights[0])) return hold("Working sets used different loads; Coach should review.");
  const increment = Number(options.incrementLb);
  if (!Number.isFinite(increment) || increment <= 0 || increment / weights[0] > 0.1) return hold("No safe, known equipment increment is configured.");
  return { decision: "propose-increase", reason: "All prescribed sets reached the top with Easy/Good effort and comparable rest; submit for review.", suggestedWeightLb: weights[0] + increment };
}
