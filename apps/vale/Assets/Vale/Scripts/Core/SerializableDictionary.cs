using System;
using System.Collections.Generic;

namespace Vale.Core
{
    /// <summary>
    /// JsonUtility cannot serialize Dictionary, so we wrap one.
    /// Keys are strings. Use when you need a key/value bag inside any [Serializable].
    /// </summary>
    [Serializable]
    public class SerializableDictionary<TKey, TValue>
    {
        public List<TKey> keys = new List<TKey>();
        public List<TValue> values = new List<TValue>();

        public TValue this[TKey key]
        {
            get
            {
                var i = keys.IndexOf(key);
                return i >= 0 ? values[i] : default;
            }
            set
            {
                var i = keys.IndexOf(key);
                if (i >= 0) values[i] = value;
                else { keys.Add(key); values.Add(value); }
            }
        }

        public bool ContainsKey(TKey key) => keys.Contains(key);

        public void Remove(TKey key)
        {
            var i = keys.IndexOf(key);
            if (i >= 0) { keys.RemoveAt(i); values.RemoveAt(i); }
        }

        public IEnumerable<TKey> Keys => keys;
        public IEnumerable<TValue> Values => values;

        public int Count => keys.Count;

        public void Clear()
        {
            keys.Clear();
            values.Clear();
        }
    }
}
