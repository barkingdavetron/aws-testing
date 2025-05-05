#!/bin/bash
npx jest tests/unit testing/tests/addIngredient.test.js
npx jest tests/unit testing/tests/getIngredients.test.js
npx jest tests/unit testing/tests/getIngredientsListString.test.js
npx jest tests/unit testing/tests/addCalories.test.js
npx jest tests/unit testing/tests/getCalories.test.js
npx jest tests/unit testing/tests/addShoppingItem.test.js
npx jest tests/unit testing/tests/getShoppingList.test.js
npx jest tests/unit testing/tests/deleteShoppingItem.test.js
npx jest tests/unit testing/tests/registerUser.test.js
npx jest tests/unit testing/tests/loginUser.test.js
npx jest tests/unit testing/tests/getLeaderboard.test.js
npx jest tests/unit testing/tests/extractExpiryDate.test.js
npx jest tests/unit testing/tests/runOCR.test.js
npx jest tests/unit testing/tests/detectFoodLabels.test.js
npx jest tests/integration/auth.integration.test.js
npx jest tests/integration/calories.integration.test.js
npx jest tests/integration/ingredient.integration.test.js
echo " All tests completed."
read -p "Press enter to close this window" base it off the routes on this aswell