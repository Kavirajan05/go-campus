import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import joblib


data = pd.read_csv("../data/dataset.csv", header=None)

data.columns = ["X","Y","B1","B2","B3","B4"]

print(data.head())  # debug

X = data[["B1","B2","B3","B4"]]
y = data[["X","Y"]]

model = RandomForestRegressor(n_estimators=100)
model.fit(X, y)

joblib.dump(model, "../model/model.pkl")

print("✅ Model trained")